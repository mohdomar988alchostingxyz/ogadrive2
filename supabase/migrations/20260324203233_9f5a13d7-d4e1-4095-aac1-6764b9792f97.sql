-- Create drive_configs table
CREATE TABLE public.drive_configs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  redirect_uri TEXT DEFAULT 'https://developers.google.com/oauthplayground',
  folder_id TEXT NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.drive_configs ENABLE ROW LEVEL SECURITY;

-- Insert the default drive configuration
INSERT INTO public.drive_configs (id, name, client_id, client_secret, refresh_token, redirect_uri, folder_id, is_active)
VALUES (
  'default',
  'Primary Drive',
  '579618470961-37dmbp1qf3qp2898va6gru89i0j4046i.apps.googleusercontent.com',
  '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',
  '1//04lcGBX8mxZsTCgYIARAAGAQSNwF-L9IrzG74soVWogfOpFBrlPvSXE8TgX_IsCkRdXbptlBHZoTfPb9LiI6UrYHZDbVqBevLI5A',
  'https://developers.google.com/oauthplayground',
  '1yAkSr2Qk2PdBVBnXA04nWx2t9cm0oTMn',
  true
);