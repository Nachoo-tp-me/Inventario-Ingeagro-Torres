"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, ImagePlus, Package, Trash2 } from "lucide-react";
import { createSupabaseClient } from "@/lib/supabase/client";
import type { Product } from "@/lib/product-catalog";
import {
  CATEGORY_NAME_MAX,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_IMAGE_BUCKET,
  PRODUCT_NAME_MAX,
  type Category,
  validateCategoryName,
  validateImage,
  validateProduct,
} from "@/lib/product-validation";
import { fieldErrorOfProduct, type ProductFieldName } from "@/lib/product-form-model";
import { similarProducts } from "@/lib/rapid-model";
import { classifyWriteError, removalDecision, writeVerdict, type IntendedProduct, type ProductRow, type ReadBack } from "@/lib/product-save-model";

type ExistingProduct = { id: string; nombre: string; categoria: string; nombre_normalizado?: string };

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type Supabase = ReturnType<typeof createSupabaseClient>;
// Identity of one logical save: kept across retries after an unconfirmed write, so nothing is generated or uploaded twice.
type Attempt = { kind: "create" | "update"; productId: string; uploadedPath: string | null; values: IntendedProduct };

const UNCERTAIN_UNVERIFIED = "No pudimos confirmar si el producto se guardó. Tus datos y la fotografía subida se conservaron; no se eliminó ningún archivo.";
const UNCERTAIN_NOT_YET = "Aún no vemos el guardado. Tus datos y la fotografía subida se conservaron. Comprueba de nuevo en unos segundos o reintenta el guardado.";
const UNCERTAIN_CONFLICT = "El producto cambió en otra sesión y no pudimos confirmar tu guardado anterior. No se eliminó ninguna fotografía. Recarga la página antes de editarlo.";
const UNCERTAIN_AFTER_REJECTION = "El servidor rechazó el reintento, pero un intento anterior no confirmado podría haberse guardado. No se eliminó ningún archivo.";

type ErrorField = ProductFieldName | "foto";
const FIELD_IDS: Record<ErrorField, string> = { nombre: "product-name", categoria: "product-category", descripcion: "product-description", foto: "product-photo" };

// A failed preview (expired signed URL, network) is hidden and the fallback text takes its place. Presentation only.
function markPreviewFailed(image: HTMLImageElement) {
  image.hidden = true;
  image.closest<HTMLElement>("[data-photo]")?.setAttribute("data-failed", "true");
}

export function ProductForm({
  initial,
  initialCategories,
  onCreated,
  onCancel,
  quick = false,
}: {
  initial?: Product;
  initialCategories: Category[];
  onCreated?: (product: ExistingProduct) => void;
  onCancel?: () => void;
  quick?: boolean;
}) {
  const router = useRouter();
  const busyRef = useRef(false);
  const checkingRef = useRef(false);
  const approvedNameRef = useRef("");
  const formRef = useRef<HTMLFormElement>(null);
  const [categories, setCategories] = useState(initialCategories);
  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [categoriaId, setCategoriaId] = useState(initial?.categoria_id ?? "");
  const [descripcion, setDescripcion] = useState(initial?.descripcion ?? "");
  const [categoryName, setCategoryName] = useState("");
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cleanupPath, setCleanupPath] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const uncertainRef = useRef<Attempt | null>(null);
  const completedRef = useRef(false);
  const cleanupOwnerRef = useRef<string | null>(null);
  const [similar, setSimilar] = useState<ExistingProduct[]>([]);
  const [fieldError, setFieldError] = useState<{ field: ErrorField; message: string } | null>(null);
  const previewRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const currentPhoto = file
    ? previewUrl
    : removePhoto
      ? null
      : initial?.fotoUrl ?? null;

  // Also catches a preview that already failed before hydration (onError never fired).
  useEffect(() => {
    const image = previewRef.current;
    if (image && image.complete && image.naturalWidth === 0) markPreviewFailed(image);
  }, [currentPhoto]);

  function focusLater(id: string) {
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("#" + id)?.focus());
  }

  // Associates an existing validation message with its field and moves focus there. In quick mode the description
  // and the photo live in the closed <details>, so their messages stay in the general area.
  function showFieldError(message: string, field: ErrorField | null) {
    setError(message);
    if (!field || (quick && (field === "descripcion" || field === "foto"))) { setFieldError(null); return; }
    setFieldError({ field, message });
    const focus = () => formRef.current?.querySelector<HTMLElement>("#" + FIELD_IDS[field])?.focus();
    focus();
    requestAnimationFrame(focus); // the file input is re-created after an invalid file
  }

  async function refreshCategories() {
    const { data, error: fetchError } = await createSupabaseClient()
      .from("categorias")
      .select("id,nombre")
      .order("nombre");
    if (fetchError) return null;
    setCategories(data ?? []);
    return data ?? [];
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || busyRef.current) return;
    const name = categoryName.trim();
    const validationError = validateCategoryName(categoryName);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setNotice("");
    busyRef.current = true;
    setPending(true);
    setStage("Creando categoría…");
    try {
      const { data, error: insertError } = await createSupabaseClient()
        .from("categorias")
        .insert({ nombre: name })
        .select("id,nombre")
        .single();
      if (insertError) {
        if (insertError.code === "23505") {
          const refreshed = await refreshCategories();
          const match = refreshed?.find(
            (category) =>
              category.nombre.trim().toLocaleLowerCase("es") ===
              name.toLocaleLowerCase("es"),
          );
          if (match) {
            setCategoriaId(match.id);
            setNotice("La categoría ya existía y quedó seleccionada.");
            setNewCategoryOpen(false);
            setCategoryName("");
            return;
          }
          setError("Esa categoría ya existe. Selecciónala en la lista.");
          return;
        }
        setError("No pudimos crear la categoría. Inténtalo de nuevo.");
        return;
      }
      setCategories((previous) =>
        [...previous, data].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
      );
      setCategoriaId(data.id);
      setCategoryName("");
      setNewCategoryOpen(false);
      setNotice("Categoría creada y seleccionada.");
    } catch {
      setError("No pudimos crear la categoría. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      busyRef.current = false;
      setPending(false);
      setStage("");
    }
  }

  function chooseFile(chosen: File | undefined) {
    if (!chosen) return;
    const validationError = validateImage(chosen);
    if (validationError) {
      showFieldError(validationError, "foto");
      setFileInputKey((key) => key + 1);
      return;
    }
    setError("");
    setNotice("");
    setFile(chosen);
    setPreviewUrl(URL.createObjectURL(chosen));
    setRemovePhoto(false);
  }

  async function readBack(supabase: Supabase, productId: string): Promise<ReadBack> {
    try {
      const { data, error: readError } = await supabase.from("productos")
        .select("id,nombre,categoria_id,descripcion,foto_ruta,actualizado_en").eq("id", productId).maybeSingle();
      if (readError) return { status: "failed" };
      return data ? { status: "row", row: data as ProductRow } : { status: "absent" };
    } catch {
      return { status: "failed" };
    }
  }

  // The ONLY way this form deletes a file it uploaded or replaced: with positive evidence (a fresh read) that no product
  // row references it. Any doubt keeps the file; an orphan is preferable to a broken reference.
  async function removeUnreferenced(supabase: Supabase, productId: string, path: string): Promise<"removed" | "referenced" | "unverified" | "failed"> {
    const decision = removalDecision(await readBack(supabase, productId), path);
    if (decision === "keep-referenced") return "referenced";
    if (decision === "keep-unverified") return "unverified";
    try {
      const { error: removeError } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
      return removeError ? "failed" : "removed";
    } catch {
      return "failed";
    }
  }

  async function retryCleanup() {
    if (!cleanupPath || pending) return;
    setPending(true);
    setStage("Eliminando fotografía anterior…");
    try {
      const owner = cleanupOwnerRef.current ?? initial?.id ?? savedId;
      const result = owner ? await removeUnreferenced(createSupabaseClient(), owner, cleanupPath) : "unverified";
      if (result === "unverified" || result === "failed") {
        setError(result === "unverified"
          ? "No pudimos comprobar si la fotografía está en uso, así que no se eliminó. Vuelve a intentarlo."
          : "No pudimos eliminar el archivo. Vuelve a intentarlo.");
        return;
      }
      setCleanupPath(null);
      setError("");
      if (savedId) {
        router.push(`/productos/${savedId}?guardado=1`);
        router.refresh();
      } else {
        setNotice(result === "referenced" ? "La fotografía está en uso por el producto; no se eliminó." : "Archivo temporal eliminado. Puedes guardar de nuevo.");
      }
    } catch {
      setError("No pudimos eliminar el archivo. Vuelve a intentarlo.");
    } finally {
      setPending(false);
      setStage("");
    }
  }

  // The write is confirmed (response received, or proven by reading the row again): continue the existing success flow once.
  async function finishSuccess(supabase: Supabase, attempt: Attempt) {
    completedRef.current = true;
    uncertainRef.current = null;
    setUncertain(false);
    const previousPhoto = initial?.foto_ruta;
    if (previousPhoto && previousPhoto !== attempt.values.foto_ruta) {
      setStage("Eliminando fotografía anterior…");
      const result = await removeUnreferenced(supabase, attempt.productId, previousPhoto);
      if (result === "unverified" || result === "failed") {
        setSavedId(attempt.productId);
        setCleanupPath(previousPhoto);
        cleanupOwnerRef.current = attempt.productId;
        setNotice("Producto guardado. Falta eliminar la fotografía anterior.");
        return;
      }
    }
    if (onCreated && !initial) onCreated({ id: attempt.productId, nombre: attempt.values.nombre,
      categoria: categories.find((item) => item.id === attempt.values.categoria_id)?.nombre ?? "Sin categoría" });
    else { router.push(`/productos/${attempt.productId}?guardado=1`); router.refresh(); }
  }

  // Unconfirmed write: keep the identity (product id, uploaded path, values) and every file; verify by reading the row.
  async function resolveUncertain(supabase: Supabase, attempt: Attempt, afterRejection: boolean) {
    uncertainRef.current = attempt;
    setUncertain(true);
    const verdict = writeVerdict(attempt.kind, await readBack(supabase, attempt.productId), attempt.values, initial?.actualizado_en);
    if (verdict === "applied") { await finishSuccess(supabase, attempt); return; }
    setError(afterRejection ? UNCERTAIN_AFTER_REJECTION : verdict === "not-applied" ? UNCERTAIN_NOT_YET : verdict === "conflict" ? UNCERTAIN_CONFLICT : UNCERTAIN_UNVERIFIED);
  }

  async function checkSaved() {
    const attempt = uncertainRef.current;
    if (!attempt || pending || busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setStage("Comprobando si se guardó…");
    setError("");
    setNotice("");
    try {
      const supabase = createSupabaseClient();
      const verdict = writeVerdict(attempt.kind, await readBack(supabase, attempt.productId), attempt.values, initial?.actualizado_en);
      if (verdict === "applied") await finishSuccess(supabase, attempt);
      else setError(verdict === "not-applied" ? UNCERTAIN_NOT_YET : verdict === "conflict" ? UNCERTAIN_CONFLICT : UNCERTAIN_UNVERIFIED);
    } finally {
      busyRef.current = false;
      setPending(false);
      setStage("");
    }
  }

  // One statement: ok, rejected by the database (proves it was not applied) or uncertain (no way to know).
  async function writeProduct(supabase: Supabase, attempt: Attempt): Promise<{ state: "ok" } | { state: "rejected"; noRows: boolean } | { state: "uncertain" }> {
    setStage(initial ? "Guardando cambios…" : "Guardando producto…");
    try {
      if (attempt.kind === "update" && initial) {
        const { data, error: updateError } = await supabase
          .from("productos")
          .update(attempt.values)
          .eq("id", initial.id)
          .eq("actualizado_en", initial.actualizado_en)
          .select("id")
          .maybeSingle();
        if (updateError) return classifyWriteError(updateError) === "definitive" ? { state: "rejected", noRows: false } : { state: "uncertain" };
        return data ? { state: "ok" } : { state: "rejected", noRows: true };
      }
      const { error: insertError } = await supabase.from("productos").insert({ id: attempt.productId, ...attempt.values });
      if (insertError) return classifyWriteError(insertError) === "definitive" ? { state: "rejected", noRows: false } : { state: "uncertain" };
      return { state: "ok" };
    } catch {
      return { state: "uncertain" };
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || busyRef.current || checkingRef.current || cleanupPath || savedId || completedRef.current) return;
    const retrying = uncertainRef.current;
    const validationError = validateProduct(
      nombre,
      categoriaId,
      categories,
      descripcion,
    );
    if (validationError) {
      showFieldError(validationError, fieldErrorOfProduct(validateProduct, nombre, categoriaId, categories, descripcion)?.field ?? null);
      return;
    }
    if (file) {
      const imageError = validateImage(file);
      if (imageError) {
        showFieldError(imageError, "foto");
        return;
      }
    }
    if (!initial && !retrying && approvedNameRef.current !== nombre) {
      checkingRef.current = true;
      setPending(true);
      setStage("Comprobando productos parecidos…");
      const supabase = createSupabaseClient();
      const existing: ExistingProduct[] = [];
      try {
        for (let start = 0; ; start += 1000) {
          const { data, error: listError } = await supabase.from("productos")
            .select("id,nombre,nombre_normalizado,categorias(nombre)").order("id").range(start, start + 999);
          if (listError) {
            setError("No pudimos comprobar productos parecidos. Inténtalo de nuevo.");
            return;
          }
          existing.push(...(data ?? []).map((item) => ({ id: item.id, nombre: item.nombre,
            nombre_normalizado: item.nombre_normalizado,
            categoria: (item.categorias as unknown as { nombre: string } | null)?.nombre ?? "Sin categoría" })));
          if (!data || data.length < 1000) break;
        }
        const candidates = similarProducts(nombre, existing);
        if (candidates.length) { setSimilar(candidates); setError(""); return; }
      } catch {
        setError("No pudimos comprobar productos parecidos. Inténtalo de nuevo.");
        return;
      } finally {
        checkingRef.current = false;
        setPending(false);
        setStage("");
      }
    }
    setSimilar([]);
    busyRef.current = true;
    setPending(true);
    setError("");
    setNotice("");
    const supabase = createSupabaseClient();
    let uploadedPath: string | null = null;
    let attempt: Attempt | null = retrying;
    let written = false;
    try {
      if (!attempt) {
        // A retry after an unconfirmed write reuses the product id and the uploaded path: nothing is generated or uploaded again.
        const productId = initial?.id ?? crypto.randomUUID();
        if (file) {
          setStage("Subiendo fotografía…");
          uploadedPath = `${productId}/${crypto.randomUUID()}.${IMAGE_EXTENSIONS[file.type]}`;
          const { error: uploadError } = await supabase.storage
            .from(PRODUCT_IMAGE_BUCKET)
            .upload(uploadedPath, file, {
              contentType: file.type,
              cacheControl: "3600",
              upsert: false,
            });
          if (uploadError) {
            setError("No pudimos subir la fotografía. Comprueba tu conexión e inténtalo de nuevo.");
            return;
          }
        }
        attempt = {
          kind: initial ? "update" : "create",
          productId,
          uploadedPath,
          values: {
            nombre,
            categoria_id: categoriaId,
            descripcion: descripcion.trim() ? descripcion : null,
            foto_ruta: uploadedPath ?? (removePhoto ? null : initial?.foto_ruta ?? null),
          },
        };
      }
      written = true;
      const outcome = await writeProduct(supabase, attempt);
      if (outcome.state === "ok") { await finishSuccess(supabase, attempt); return; }
      if (outcome.state === "uncertain" || retrying) { await resolveUncertain(supabase, attempt, outcome.state === "rejected"); return; }
      // First attempt rejected by the database: the statement was not applied. Still, a file is deleted only with proof.
      if (attempt.uploadedPath) {
        const result = await removeUnreferenced(supabase, attempt.productId, attempt.uploadedPath);
        if (result === "referenced") { await finishSuccess(supabase, attempt); return; }
        if (result === "unverified" || result === "failed") {
          setCleanupPath(attempt.uploadedPath);
          cleanupOwnerRef.current = attempt.productId;
        }
      }
      setError(outcome.noRows
        ? "El producto cambió en otra sesión. Recarga la página antes de editarlo."
        : initial
          ? "No pudimos guardar los cambios. Inténtalo de nuevo."
          : "No pudimos guardar el producto. Revisa los datos e inténtalo de nuevo.");
    } catch {
      if (!written) {
        // Nothing was written (the upload threw): remove the temporary file only with proof that it is unreferenced.
        if (uploadedPath) {
          const result = await removeUnreferenced(supabase, initial?.id ?? uploadedPath.split("/")[0], uploadedPath);
          if (result === "unverified" || result === "failed") {
            setCleanupPath(uploadedPath);
            cleanupOwnerRef.current = initial?.id ?? uploadedPath.split("/")[0];
          }
        }
        setError("Ocurrió un problema de conexión. Inténtalo de nuevo.");
      } else if (attempt && !completedRef.current) {
        uncertainRef.current = attempt;
        setUncertain(true);
        setError(UNCERTAIN_UNVERIFIED);
      } else {
        setError("La operación terminó con un aviso inesperado. Comprueba el producto antes de reintentar.");
      }
    } finally {
      busyRef.current = false;
      setPending(false);
      setStage("");
    }
  }

  const locked = !!savedId || uncertain;
  const inlineField = fieldError && fieldError.message === error ? fieldError.field : null;
  const globalError = inlineField ? "" : error;
  const invalidProps = (field: ErrorField) => inlineField === field
    ? { "aria-invalid": true, "aria-describedby": FIELD_IDS[field] + "-error" } as const
    : {};
  const storedUnavailable = !file && !removePhoto && !!initial?.foto_ruta && !initial.fotoUrl;
  const hasPhoto = !!currentPhoto || storedUnavailable;
  const pendingRemoval = removePhoto && !!initial?.foto_ruta;

  const descriptionField = (
    <>
      <label className="catalog-field" htmlFor="product-description">
        <span>Descripción <small>Opcional</small></span>
        <textarea
          id="product-description"
          value={descripcion}
          onChange={(event) => setDescripcion(event.target.value)}
          maxLength={PRODUCT_DESCRIPTION_MAX}
          rows={5}
          placeholder="Detalles que ayuden a identificarlo"
          disabled={pending || locked}
          {...invalidProps("descripcion")}
        />
      </label>
      {inlineField === "descripcion" && <p id="product-description-error" className="catalog-field-error" role="alert">{error}</p>}
    </>
  );

  const photoSection = (
    <div className="catalog-form-section">
      <h2>Fotografía</h2>
      <p>JPG, PNG o WebP · hasta 5 MB.</p>
      <div className="catalog-photo-editor">
        <div className="catalog-photo-preview" data-photo key={currentPhoto ?? "sin-vista-previa"}>
          <Package className="catalog-preview-icon" size={44} aria-hidden="true" />
          {currentPhoto && (
            // URL local temporal o firmada del bucket privado.
            // eslint-disable-next-line @next/next/no-img-element
            <img ref={previewRef} src={currentPhoto} alt="Vista previa del producto" onError={(event) => markPreviewFailed(event.currentTarget)} />
          )}
          <span className="catalog-preview-failed">No se pudo cargar la vista previa</span>
        </div>
        <div className="catalog-photo-controls">
          <label className="catalog-file-button" htmlFor="product-photo">
            <ImagePlus size={18} aria-hidden="true" />
            {hasPhoto ? "Reemplazar foto" : "Añadir foto"}
          </label>
          <input
            key={fileInputKey}
            id="product-photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => chooseFile(event.target.files?.[0])}
            disabled={pending || locked}
            {...invalidProps("foto")}
          />
          {inlineField === "foto" && <p id="product-photo-error" className="catalog-field-error" role="alert">{error}</p>}
          {hasPhoto && (
            <button type="button" id="product-photo-remove" className="catalog-quiet-button" disabled={pending || locked} onClick={() => {
              setFile(null);
              setPreviewUrl(null);
              setFileInputKey((key) => key + 1);
              setRemovePhoto(true);
              if (initial?.foto_ruta) focusLater("product-photo-undo");
            }}><Trash2 size={16} aria-hidden="true" /> Quitar foto</button>
          )}
          {storedUnavailable && <span className="catalog-photo-note">Fotografía guardada. Vista previa no disponible</span>}
          {pendingRemoval && (
            <span className="catalog-photo-note" role="status">
              La fotografía se eliminará cuando guardes.
              <button type="button" id="product-photo-undo" className="catalog-quiet-button" disabled={pending || locked} onClick={() => {
                setRemovePhoto(false);
                focusLater("product-photo-remove");
              }}>Deshacer</button>
            </span>
          )}
          <span>La fotografía es opcional.</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className={quick ? "catalog-form-layout quick" : "catalog-form-layout"}>
      <form ref={formRef} className={quick ? "catalog-form" : "catalog-form catalog-form-split"} onSubmit={save} noValidate>
        <div className="catalog-form-section">
          <h2>Datos del producto</h2>
          {quick ? <p>La foto y la descripción se pueden completar después.</p> : <p className="catalog-form-note">{initial
            ? "Aquí editas los datos del producto; para cambiar sus existencias usa «Agregar stock» o «Acciones» en su ficha."
            : "La descripción y la foto se pueden completar después. Las existencias se agregan luego con «Agregar stock» en la ficha del producto."}</p>}
          <label className="catalog-field" htmlFor="product-name">
            <span>Nombre {quick ? <b>*</b> : <small className="catalog-required">Obligatorio</small>}</span>
            <input
              id="product-name"
              value={nombre}
              onChange={(event) => { setNombre(event.target.value); setSimilar([]); approvedNameRef.current = ""; }}
              maxLength={PRODUCT_NAME_MAX}
              placeholder="Ej. ESP32-S3"
              autoComplete="off"
              required
              disabled={pending || locked}
              {...invalidProps("nombre")}
            />
          </label>
          {inlineField === "nombre" && <p id="product-name-error" className="catalog-field-error" role="alert">{error}</p>}
          <label className="catalog-field" htmlFor="product-category">
            <span>Categoría {quick ? <b>*</b> : <small className="catalog-required">Obligatorio</small>}</span>
            <select
              id="product-category"
              value={categoriaId}
              onChange={(event) => {
                if (event.target.value === "__new__") setNewCategoryOpen(true);
                else setCategoriaId(event.target.value);
              }}
              required
              disabled={pending || locked}
              {...invalidProps("categoria")}
            >
              <option value="">Selecciona una categoría</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.nombre}</option>
              ))}
              <option value="__new__">+ Nueva categoría</option>
            </select>
          </label>
          {inlineField === "categoria" && <p id="product-category-error" className="catalog-field-error" role="alert">{error}</p>}
          {newCategoryOpen && (
            <div className="category-inline">
              <label className="catalog-field" htmlFor="category-name">
                <span>Nueva categoría</span>
                <input
                  id="category-name"
                  form="category-form"
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  maxLength={CATEGORY_NAME_MAX}
                  placeholder="Nombre de la categoría"
                  disabled={pending}
                  autoFocus
                />
              </label>
              <div className="catalog-inline-actions">
                <button type="submit" form="category-form" className="catalog-button" disabled={pending}>Crear categoría</button>
                <button type="button" className="catalog-quiet-button" onClick={() => setNewCategoryOpen(false)} disabled={pending}>Cancelar</button>
              </div>
            </div>
          )}
        </div>

        {quick ? (
          <details className="quick-more-details compact" open={false}>
          <summary>Más detalles (opcional)</summary>
            {descriptionField}
            {photoSection}
          </details>
        ) : (
          <>
            <div className="catalog-form-section">
              <h2>Descripción</h2>
              <p>Opcional: detalles que ayuden a identificar el producto.</p>
              {descriptionField}
            </div>
            {photoSection}
          </>
        )}

        {similar.length > 0 && <div className="similar-warning" role="alert">
          <strong>Encontramos productos parecidos</strong>
          <p>Revisa si el producto ya existe antes de crear otro registro.</p>
          {similar.map((item) => <div className="similar-candidate" key={item.id}>
            <span><strong>{item.nombre}</strong><small>{item.categoria}</small></span>
            <button type="button" className="catalog-button primary" onClick={() => {
              if (onCreated) onCreated(item);
              else router.push(`/productos/${item.id}`);
            }}>Usar este producto</button>
          </div>)}
          <button type="button" className="catalog-quiet-button" onClick={() => {
            approvedNameRef.current = nombre;
            formRef.current?.requestSubmit();
          }}>Crear de todos modos</button>
        </div>}

        {globalError && <p className="catalog-message error" role="alert">{globalError}</p>}
        {notice && <p className="catalog-message success" role="status"><CheckCircle2 size={18} aria-hidden="true" /> {notice}</p>}
        {cleanupPath && (
          <button type="button" className="catalog-button" onClick={retryCleanup} disabled={pending}>Reintentar eliminación del archivo</button>
        )}
        {uncertain && (
          <button type="button" className="catalog-button" onClick={checkSaved} disabled={pending}>Comprobar si se guardó</button>
        )}
        {savedId && <Link className="catalog-quiet-button" href={`/productos/${savedId}?guardado=1`}>Ver producto guardado</Link>}
        <p className="catalog-save-status" role="status" aria-live="polite">{pending ? stage : ""}</p>
        <div className="catalog-form-actions">
          {onCancel ? <button type="button" onClick={onCancel} className="catalog-quiet-button" disabled={pending}>Cancelar</button> : <Link href={initial ? `/productos/${initial.id}` : "/productos"} className="catalog-quiet-button">Cancelar</Link>}
          <button type="submit" className="catalog-button primary" disabled={pending || !!cleanupPath || !!savedId}>
            {pending ? stage : uncertain ? "Reintentar guardado" : initial ? "Guardar cambios" : quick ? "Agregar producto" : "Crear producto"}
          </button>
        </div>
      </form>
      <form id="category-form" onSubmit={addCategory} className="catalog-hidden-form" />
    </div>
  );
}
