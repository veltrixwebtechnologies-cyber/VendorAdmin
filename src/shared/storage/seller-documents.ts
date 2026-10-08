import type { StoredFile } from "@/shared/core/seller";

import { supabase } from "@/integrations/supabase/client";

export async function uploadSellerDoc(
  userId: string,
  sellerId: string,
  docType: string,
  file: File,
): Promise<StoredFile> {
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error("File must be under 5 MB");
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const allowedExtensions = ["pdf", "jpg", "jpeg", "png", "webp", "heic", "heif"];
  const isAllowedExt = allowedExtensions.includes(ext);
  const isAllowedMime =
    file.type === "image/jpeg" ||
    file.type === "image/png" ||
    file.type === "image/webp" ||
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    file.type === "application/pdf";

  if (!isAllowedExt && !isAllowedMime) {
    throw new Error(
      "Unsupported or invalid document file. Please upload a PDF, PNG, JPG, or WEBP document.",
    );
  }

  const path = `${userId}/${docType}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("seller-docs")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { error: documentError } = await supabase.from("seller_documents").insert({
    seller_id: sellerId,
    user_id: userId,
    doc_type: docType,
    file_name: file.name,
    file_url: path,
    file_size: file.size,
  });
  if (documentError) throw documentError;
  return { name: file.name, size: file.size, type: file.type, path };
}

export async function signedDocUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("seller-docs").createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}
