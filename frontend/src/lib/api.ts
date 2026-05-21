import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface ReasonFact {
  label: string;
  value: string;
  direction: 'positive' | 'negative' | 'neutral';
  contribution: number;
}

export interface VisitPlanItem {
  retailer_id: string;
  tehsil: string;
  district: string;
  score: number;
  recommended_sku: string;
  recommended_sku_id: string;
  recommended_action: string;
  one_line_why: string;
  reasons: ReasonFact[];
}

export interface DailyPlanResponse {
  rep_id: string;
  as_of_date: string;
  week_end_date: string;
  weights_used: Record<string, number>;
  visits: VisitPlanItem[];
}

export interface Anomaly {
  week_end_date: string;
  district: string;
  sku_id: string;
  sku_name: string;
  kind: 'demand_spike' | 'demand_drop' | 'stockout_risk';
  severity: number;
  z_score: number | null;
  current_value: number;
  baseline_value: number;
  explanation: string;
  affected_retailers: string[];
  affected_reps: string[];
}

export const fetchDailyPlan = async (repId: string, date: string, topN: number = 7): Promise<DailyPlanResponse> => {
  const { data } = await api.get(`/plan/today?rep_id=${repId}&date=${date}&top_n=${topN}`);
  return data;
};

export const fetchWeeks = async () => {
  const { data } = await api.get('/weeks');
  return data;
};

export const fetchVisitDetail = async (retailerId: string, date: string) => {
  const { data } = await api.get(`/visit/${retailerId}/detail?date=${date}`);
  return data;
};

export const fetchAnomalies = async (repId: string): Promise<Anomaly[]> => {
  // Using dummy district or fetching all for rep
  const { data } = await api.get(`/anomalies?rep_id=${repId}`);
  return data;
};

export const logOutcome = async (payload: {
  rep_id: string;
  retailer_id: string;
  visit_date: string;
  sku_discussed: string;
  outcome: string;
  notes?: string;
  offline_queued_at?: string;
}) => {
  const { data } = await api.post('/outcome', payload);
  return data;
};
