const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const EDGE_URL = `${SUPABASE_URL}/functions/v1/drive-api`;

export async function driveApi(action: string, options: {
  method?: string;
  body?: any;
  params?: Record<string, string>;
  isFormData?: boolean;
} = {}) {
  const { method = 'POST', body, params = {}, isFormData = false } = options;

  const searchParams = new URLSearchParams({ action, ...params });
  const url = `${EDGE_URL}?${searchParams.toString()}`;

  const headers: Record<string, string> = {
    'apikey': SUPABASE_KEY,
  };

  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
  });

  return res;
}

export function getDownloadUrl(action: string, params: Record<string, string> = {}) {
  const searchParams = new URLSearchParams({ action, ...params });
  return `${EDGE_URL}?${searchParams.toString()}&apikey=${SUPABASE_KEY}`;
}
