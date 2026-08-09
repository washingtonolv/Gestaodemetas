import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.9/+esm';

export const supabase = createClient(
  'https://szphqhiqblnkcuwusswe.supabase.co',
  'sb_publishable_M3gWc01p_i3yukP6xQfPsg_EAbgoC-t',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

export async function getSessionProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { session: null, profile: null };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id,nome,email,login,role,ativo')
    .eq('id', session.user.id)
    .single();

  if (error) throw error;
  return { session, profile };
}

export function roleLabel(role) {
  return ({
    administrador: 'Administrador',
    gerente_comercial: 'Gerente Comercial',
    supervisor: 'Supervisor',
    pendente: 'Pendente',
  })[role] || role;
}
