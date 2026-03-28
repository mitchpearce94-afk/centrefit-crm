-- Auto-create staff record when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role public.staff_role;
  staff_count INTEGER;
BEGIN
  -- First user is admin, everyone else is field_staff
  SELECT COUNT(*) INTO staff_count FROM public.staff;
  IF staff_count = 0 THEN
    user_role := 'admin';
  ELSE
    user_role := 'field_staff';
  END IF;

  INSERT INTO public.staff (id, email, display_name, initials, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    UPPER(LEFT(split_part(NEW.email, '@', 1), 2)),
    user_role
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
