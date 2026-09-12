import { supabase } from '@/integrations/supabase/client';

export interface DemandForecastItem {
  product_id: string;
  product_name: string;
  category: string;
  current_stock: number;
  price: number;
  image_url: string | null;
  daily_sales_velocity: number;
  monthly_views_count: number;
  days_until_stockout: number;
  stockout_risk_level: 'stockout' | 'high' | 'medium' | 'low';
  recommended_restock_qty: number;
}

export async function fetchSellerDemandForecast(sellerId: string): Promise<DemandForecastItem[]> {
  try {
    const { data, error } = await (supabase as any).rpc('get_seller_demand_forecast', {
      p_seller_id: sellerId,
    });

    if (error) throw error;
    return (data || []) as DemandForecastItem[];
  } catch (err) {
    console.warn('[ml-forecast-service] Forecast RPC fallback:', err);
    return [];
  }
}
