CREATE POLICY "Users read own photo memory files"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'photo-memories' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users upload own photo memory files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'photo-memories' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users update own photo memory files"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'photo-memories' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users delete own photo memory files"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'photo-memories' AND (storage.foldername(name))[1] = auth.uid()::text);