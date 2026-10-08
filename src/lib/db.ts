// Compatibility facade. New code imports the owning module directly.
export type * from "@/shared/core/seller";
export { getDataErrorMessage, rowToSeller, sellerPatchToDb } from "@/shared/services/data-mappers";
export {
  useMySeller,
  useCreateDraftSeller,
  useUpdateMySeller,
  useConfirmSellerStoreLocation,
  useSubmitMySeller,
  useDeleteMyAccount,
} from "@/modules/seller/services/profile";
export {
  useAllSellers,
  useSellerById,
  useReviewSeller,
  useDeleteSeller,
} from "@/modules/admin/services/sellers";
export { useIsAdmin, useHasAnyAdmin, useClaimFirstAdmin } from "@/shared/auth/legacy-admin";
export {
  useMyOrders,
  useOrderNotificationListener,
  useAdvanceOrder,
  useCancelOrder,
  useVendorAcceptOrder,
  useVendorRejectOrder,
  useVendorMarkReady,
  useVendorUpdateLiveLocation,
  useVendorStopLiveLocation,
} from "@/modules/seller/services/orders";
export {
  playOrderNotificationSound,
  triggerDesktopOrderNotification,
  useMyNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "@/shared/notifications/seller-events";
export { useUpdateProductStock } from "@/modules/seller/services/inventory";
export type {
  CycleSummary,
  SellerFinancialAdjustmentSummary,
} from "@/modules/seller/services/settlements";
export { useMySettlements, useMyFinancialAdjustments } from "@/modules/seller/services/settlements";
export { uploadSellerDoc, signedDocUrl } from "@/shared/storage/seller-documents";
