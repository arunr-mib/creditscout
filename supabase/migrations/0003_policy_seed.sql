-- Risk Officer policy. Editable without a deploy — that is the point.
insert into policy (key, value) values
  ('variance_tolerance',               '0.05'::jsonb),
  ('escalate_if_breach_margin_over',   '0.15'::jsonb),
  ('prohibited_actions',               '["waive covenant","amend terms","contact borrower"]'::jsonb),
  ('max_steps',                        '8'::jsonb),
  -- locked. displayed as locked. a regulatory boundary, not a setting.
  ('require_human_review',             'true'::jsonb)
on conflict (key) do nothing;
