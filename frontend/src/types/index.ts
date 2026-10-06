export interface Customer {
  id: number;
  customer_code: string;
  full_name: string;
  phone_number: string;
  email?: string;
  gender?: string;
  segment_name: string;
  total_visits: number;
  total_spent: number;
  last_visit_date?: string;
}

export interface PhotoAnalysis {
  photo_id: number;
  original_image_url: string;
  face_shape: string;
  hair_length: string;
  hair_density: string;
  beard_style_current: string;
}

export interface StyleItem {
  style_id: number;
  style_code: string;
  name: string;
  category: string;
  face_shapes: string[];
  hair_types: string[];
  hair_length: string;
  hair_density: string;
  maintenance_level: string;
  description: string;
  stylist_instructions: string;
  preview_image_url: string | null;
}

export interface RecommendationResponse {
  recommendation_id: number;
  target_service_type: string;
  style_category: string;
  recommended_styles: StyleItem[];
}

export interface GenerationStatusItem {
  style_id: number;
  style_name: string;
  generated_image_url: string;
  status: string;
  progress: number;
  error?: string | null;
  model_used?: string | null;
  identity_score?: number | null;
  hair_consistency_score?: number | null;
  generation_time?: number | null;
}

export interface SelectionResponse {
  selection_id: number;
  customer_id: number;
  selected_hairstyle_name: string;
  reference_image_url: string;
  haircut_instructions: string[];
  audio_instruction_url?: string;
}

export interface HeatmapPoint {
  day: string;
  hour: number;
  traffic: number;
  utilization_pct: number;
  is_lean: boolean;
  is_peak: boolean;
}
