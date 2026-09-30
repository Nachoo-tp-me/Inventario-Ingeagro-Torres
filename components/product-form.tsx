"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, ImagePlus, Package, Plus, Trash2 } from "lucide-react";
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
import { similarProducts } from "@/lib/rapid-model";

type ExistingProduct = { id: string; nombre: string; categoria: string; nombre_normalizado?: string };

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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
  const [similar, setSimilar] = useState<ExistingProduct[]>([]);

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
      setError(validationError);
      setFileInputKey((key) => key + 1);
      return;
    }
    setError("");
    setNotice("");
    setFile(chosen);
    setPreviewUrl(URL.createObjectURL(chosen));
    setRemovePhoto(false);
  }

  async function retryCleanup() {
    if (!cleanupPath || pending) return;
    setPending(true);
    setStage("Eliminando fotografía anterior…");
    try {
      const { error: removeError } = await createSupabaseClient()
        .storage.from(PRODUCT_IMAGE_BUCKET).remove([cleanupPath]);
      if (removeError) throw removeError;
      setCleanupPath(null);
      setError("");
      if (savedId) {
        router.push(`/productos/${savedId}?guardado=1`);
        router.refresh();
      } else {
        setNotice("Archivo temporal eliminado. Puedes guardar de nuevo.");
      }
    } catch {
      setError("No pudimos eliminar el archivo. Vuelve a intentarlo.");
    } finally {
      setPending(false);
      setStage("");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || busyRef.current || checkingRef.current || cleanupPath || savedId) return;
    const validationError = validateProduct(
      nombre,
      categoriaId,
      categories,
      descripcion,
    );
    if (validationError) {
      setError(validationError);
      return;
    }
    if (file) {
      const imageError = validateImage(file);
      if (imageError) {
        setError(imageError);
        return;
      }
    }
    if (!initial && approvedNameRef.current !== nombre) {
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
    const productId = initial?.id ?? crypto.randomUUID();
    let uploadedPath: string | null = null;
    let saved = false;
    try {
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
      setStage(initial ? "Guardando cambios…" : "Guardando producto…");
      const values = {
        nombre,
        categoria_id: categoriaId,
        descripcion: descripcion.trim() ? descripcion : null,
        foto_ruta: uploadedPath ?? (removePhoto ? null : initial?.foto_ruta ?? null),
      };
      if (initial) {
        const { data, error: updateError } = await supabase
          .from("productos")
          .update(values)
          .eq("id", initial.id)
          .eq("actualizado_en", initial.actualizado_en)
          .select("id")
          .maybeSingle();
        if (updateError || !data) {
          if (uploadedPath) {
            const { error: cleanupError } = await supabase.storage
              .from(PRODUCT_IMAGE_BUCKET).remove([uploadedPath]);
            if (cleanupError) setCleanupPath(uploadedPath);
          }
          setError(
            updateError
              ? "No pudimos guardar los cambios. Inténtalo de nuevo."
              : "El producto cambió en otra sesión. Recarga la página antes de editarlo.",
          );
          return;
        }
        saved = true;
      } else {
        const { error: insertError } = await supabase
          .from("productos")
          .insert({ id: productId, ...values });
        if (insertError) {
          if (uploadedPath) {
            const { error: cleanupError } = await supabase.storage
              .from(PRODUCT_IMAGE_BUCKET).remove([uploadedPath]);
            if (cleanupError) setCleanupPath(uploadedPath);
          }
          setError("No pudimos guardar el producto. Revisa los datos e inténtalo de nuevo.");
          return;
        }
        saved = true;
      }

      const previousPhoto = initial?.foto_ruta;
      if (previousPhoto && previousPhoto !== values.foto_ruta) {
        setStage("Eliminando fotografía anterior…");
        const { error: removeError } = await supabase.storage
          .from(PRODUCT_IMAGE_BUCKET).remove([previousPhoto]);
        if (removeError) {
          setSavedId(productId);
          setCleanupPath(previousPhoto);
          setNotice("Producto guardado. Falta eliminar la fotografía anterior.");
          return;
        }
      }
      if (onCreated && !initial) onCreated({ id: productId, nombre,
        categoria: categories.find((item) => item.id === categoriaId)?.nombre ?? "Sin categoría" });
      else { router.push(`/productos/${productId}?guardado=1`); router.refresh(); }
    } catch {
      if (saved) {
        setSavedId(productId);
        setNotice("Producto guardado. Comprueba que se eliminó la fotografía anterior.");
        if (initial?.foto_ruta && (uploadedPath || removePhoto))
          setCleanupPath(initial.foto_ruta);
      } else if (uploadedPath) {
        try {
          const { error: cleanupError } = await supabase.storage
            .from(PRODUCT_IMAGE_BUCKET).remove([uploadedPath]);
          if (cleanupError) setCleanupPath(uploadedPath);
        } catch {
          setCleanupPath(uploadedPath);
        }
      }
      setError(saved ? "La actualización se guardó, pero falta comprobar la limpieza de la foto." : "Ocurrió un problema de conexión. Inténtalo de nuevo.");
    } finally {
      busyRef.current = false;
      setPending(false);
      setStage("");
    }
  }

  return (
    <div className={quick ? "catalog-form-layout quick" : "catalog-form-layout"}>
      <form ref={formRef} className="catalog-form" onSubmit={save} noValidate>
        <div className="catalog-form-section">
          <h2>Datos del producto</h2>
          <p>La foto y la descripción se pueden completar después.</p>
          <label className="catalog-field" htmlFor="product-name">
            <span>Nombre <b>*</b></span>
            <input
              id="product-name"
              value={nombre}
              onChange={(event) => { setNombre(event.target.value); setSimilar([]); approvedNameRef.current = ""; }}
              maxLength={PRODUCT_NAME_MAX}
              placeholder="Ej. ESP32-S3"
              autoComplete="off"
              required
              disabled={pending || !!savedId}
            />
          </label>
          <label className="catalog-field" htmlFor="product-category">
            <span>Categoría <b>*</b></span>
            <select
              id="product-category"
              value={categoriaId}
              onChange={(event) => {
                if (event.target.value === "__new__") setNewCategoryOpen(true);
                else setCategoriaId(event.target.value);
              }}
              required
              disabled={pending || !!savedId}
            >
              <option value="">Selecciona una categoría</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.nombre}</option>
              ))}
              <option value="__new__">+ Nueva categoría</option>
            </select>
          </label>
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

        <details className={quick ? "quick-more-details compact" : "quick-more-details"} open={!quick}>
          <summary>Más detalles (opcional)</summary>
          <label className="catalog-field" htmlFor="product-description">
            <span>Descripción <small>Opcional</small></span>
            <textarea
              id="product-description"
              value={descripcion}
              onChange={(event) => setDescripcion(event.target.value)}
              maxLength={PRODUCT_DESCRIPTION_MAX}
              rows={5}
              placeholder="Detalles que ayuden a identificarlo"
              disabled={pending || !!savedId}
            />
          </label>
        <div className="catalog-form-section">
          <h2>Fotografía</h2>
          <p>JPG, PNG o WebP · hasta 5 MB.</p>
          <div className="catalog-photo-editor">
            <div className="catalog-photo-preview">
              {currentPhoto ? (
                // URL local temporal o firmada del bucket privado.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={currentPhoto} alt="Vista previa del producto" />
              ) : <Package size={44} aria-hidden="true" />}
            </div>
            <div className="catalog-photo-controls">
              <label className="catalog-file-button" htmlFor="product-photo">
                <ImagePlus size={18} aria-hidden="true" />
                {currentPhoto ? "Reemplazar foto" : "Añadir foto"}
              </label>
              <input
                key={fileInputKey}
                id="product-photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => chooseFile(event.target.files?.[0])}
                disabled={pending || !!savedId}
              />
              {currentPhoto && (
                <button type="button" className="catalog-quiet-button" disabled={pending || !!savedId} onClick={() => {
                  setFile(null);
                  setPreviewUrl(null);
                  setFileInputKey((key) => key + 1);
                  setRemovePhoto(true);
                }}><Trash2 size={16} aria-hidden="true" /> Quitar foto</button>
              )}
              <span>La fotografía es opcional.</span>
            </div>
          </div>
        </div>
        </details>

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

        {error && <p className="catalog-message error" role="alert">{error}</p>}
        {notice && <p className="catalog-message success" role="status"><CheckCircle2 size={18} aria-hidden="true" /> {notice}</p>}
        {cleanupPath && (
          <button type="button" className="catalog-button" onClick={retryCleanup} disabled={pending}>Reintentar eliminación del archivo</button>
        )}
        {savedId && <Link className="catalog-quiet-button" href={`/productos/${savedId}?guardado=1`}>Ver producto guardado</Link>}
        <div className="catalog-form-actions">
          {onCancel ? <button type="button" onClick={onCancel} className="catalog-quiet-button" disabled={pending}>Cancelar</button> : <Link href={initial ? `/productos/${initial.id}` : "/productos"} className="catalog-quiet-button">Cancelar</Link>}
          <button type="submit" className="catalog-button primary" disabled={pending || !!cleanupPath || !!savedId}>
            {pending ? stage : initial ? "Guardar cambios" : "Agregar producto"}
          </button>
        </div>
      </form>
      <form id="category-form" onSubmit={addCategory} className="catalog-hidden-form" />
      {!quick && <aside className="catalog-form-aside">
        <span className="catalog-aside-icon"><Plus size={23} aria-hidden="true" /></span>
        <h2>Un catálogo claro para todo el equipo</h2>
        <p>Registra el producto una sola vez. Sus existencias y ubicaciones aparecerán aquí cuando se asignen movimientos de inventario.</p>
      </aside>}
    </div>
  );
}
