import type { Seller } from "@/shared/core/seller";
import { parseCoordinates } from "@/lib/coordinates";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

import { rowToSeller, sellerPatchToDb, normalizeCoordinate } from "@/shared/services/data-mappers";

export function useMySeller() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["my-seller", user?.id],
    enabled: !!user,
    retry: 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sellers")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      if (data) return rowToSeller(data);
      // Return null when seller profile does not exist or was deleted
      return null;
    },
  });
  return q;
}

export function useCreateDraftSeller() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const { data: existing } = await supabase
        .from("sellers")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing) return rowToSeller(existing);

      const { data: created, error } = await supabase
        .from("sellers")
        .insert({ user_id: user.id, email: user.email ?? null })
        .select("*")
        .single();
      if (error) throw error;
      return rowToSeller(created);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-seller"] });
    },
  });
}

export function useUpdateMySeller() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Seller>) => {
      if (!user) throw new Error("Not signed in");
      // Read current wizard_data
      const { data: cur } = await supabase
        .from("sellers")
        .select("wizard_data")
        .eq("user_id", user.id)
        .maybeSingle();
      const curWizard =
        cur?.wizard_data && typeof cur.wizard_data === "object" && !Array.isArray(cur.wizard_data)
          ? (cur.wizard_data as Record<string, any>)
          : {};
      const dbPatch = sellerPatchToDb(patch, curWizard);
      const { data, error } = await supabase
        .from("sellers")
        .update(dbPatch as any)
        .eq("user_id", user.id)
        .select("*")
        .single();
      if (error) throw error;
      return rowToSeller(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-seller"] }),
  });
}

export function useConfirmSellerStoreLocation() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (location: {
      addressLine1: string;
      addressLine2?: string;
      city: string;
      state: string;
      pincode: string;
      latitude: number;
      longitude: number;
      googlePlaceId?: string | null;
    }) => {
      if (!user) throw new Error("Sign in to update your store location.");
      const { data, error } = await (supabase as any).rpc("confirm_seller_store_location", {
        p_address_line1: location.addressLine1,
        p_address_line2: location.addressLine2?.trim() || null,
        p_city: location.city,
        p_state: location.state,
        p_pincode: location.pincode,
        p_latitude: location.latitude,
        p_longitude: location.longitude,
        p_google_place_id: location.googlePlaceId?.trim() || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-seller", user?.id] });
      void qc.invalidateQueries({ queryKey: ["my-seller"] });
    },
  });
}

export function useSubmitMySeller() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const { data: cur, error: readError } = await supabase
        .from("sellers")
        .select("wizard_data,lat,lng")
        .eq("user_id", user.id)
        .maybeSingle();
      if (readError) throw readError;
      const curWizard =
        cur?.wizard_data && typeof cur.wizard_data === "object" && !Array.isArray(cur.wizard_data)
          ? (cur.wizard_data as Record<string, any>)
          : {};
      const shopPin =
        parseCoordinates(cur?.lat, cur?.lng) ??
        normalizeCoordinate(curWizard.shopCoordinates) ??
        parseCoordinates(curWizard.lat, curWizard.lng) ??
        parseCoordinates(curWizard.pickupLat, curWizard.pickupLng) ??
        normalizeCoordinate(curWizard.pickupCoordinates);
      if (!shopPin) throw new Error("Set the store entrance on the Google Map before submitting.");
      const pickupPin =
        curWizard.pickupSame === false
          ? (parseCoordinates(curWizard.pickupLat, curWizard.pickupLng) ??
            normalizeCoordinate(curWizard.pickupCoordinates))
          : shopPin;
      if (!pickupPin) throw new Error("Set the separate pickup entrance before submitting.");

      const w = {
        ...curWizard,
        lat: shopPin.lat,
        lng: shopPin.lng,
        pickupLat: pickupPin.lat,
        pickupLng: pickupPin.lng,
        shopCoordinates: shopPin,
        pickupCoordinates: pickupPin,
        locationConfirmationRequired: false,
        submittedAt: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("sellers")
        .update({
          lat: shopPin.lat,
          lng: shopPin.lng,
          status: "pending",
          wizard_data: w as any,
        })
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-seller"] }),
  });
}

export function useDeleteMyAccount() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sellerId: string) => {
      // Clean up seller related tables
      await supabase.from("seller_documents").delete().eq("seller_id", sellerId);
      await (supabase as any).from("shop_hours").delete().eq("seller_id", sellerId);
      await (supabase as any).from("shop_overrides").delete().eq("seller_id", sellerId);
      await (supabase as any).from("shop_holidays").delete().eq("seller_id", sellerId);
      await (supabase as any).from("shop_availability_log").delete().eq("seller_id", sellerId);
      await supabase.from("products").delete().eq("seller_id", sellerId);
      const { error } = await supabase.from("sellers").delete().eq("id", sellerId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-seller", user?.id] });
      qc.invalidateQueries({ queryKey: ["my-seller"] });
      qc.invalidateQueries({ queryKey: ["admin-sellers"] });
      qc.invalidateQueries({ queryKey: ["shop-hours"] });
      qc.invalidateQueries({ queryKey: ["shop-status"] });
    },
  });
}
