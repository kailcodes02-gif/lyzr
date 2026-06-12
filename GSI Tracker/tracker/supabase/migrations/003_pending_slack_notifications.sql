-- ==========================================
-- CREATE PENDING SLACK NOTIFICATIONS TABLE
-- ==========================================

CREATE TABLE pending_slack_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed'
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE pending_slack_notifications ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/write
CREATE POLICY "auth_read" ON pending_slack_notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON pending_slack_notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
