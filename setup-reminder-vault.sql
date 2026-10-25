-- Run in SQL Editor of Supabase project Tasks (ozhiklonwyjlerpouglf).
-- Replace the placeholder with the EXACT value saved as Edge Function secret STUDYGLASS_CRON_SECRET.
-- Do not use the Resend key or the Supabase publishable key here.
-- The scheduled job is already configured; this stores the same caller secret in Vault.
DO $setup$
DECLARE
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id
  FROM vault.secrets
  WHERE name = 'studyglass_cron_secret'
  LIMIT 1;

  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(
      $sgsecret$PASTE_THE_STUDYGLASS_CRON_SECRET_HERE$sgsecret$,
      'studyglass_cron_secret',
      'Private caller secret for StudyGlass reminder scheduler'
    );
  ELSE
    PERFORM vault.update_secret(
      existing_id,
      $sgsecret$PASTE_THE_STUDYGLASS_CRON_SECRET_HERE$sgsecret$,
      'studyglass_cron_secret',
      'Private caller secret for StudyGlass reminder scheduler'
    );
  END IF;
END
$setup$;
