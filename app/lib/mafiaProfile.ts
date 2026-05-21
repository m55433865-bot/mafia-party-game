import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type MafiaProfile = {
  avatar_url: string | null;
  display_name: string | null;
  games_played: number;
  games_won: number;
  id: string;
};

const mafiaProfileSelect = "id, display_name, avatar_url, games_played, games_won";

export function isMafiaProfileComplete(profile: MafiaProfile | null) {
  return Boolean(profile?.display_name?.trim() && profile.avatar_url?.trim());
}

export async function getMafiaProfile(userId: string) {
  const { data, error } = await supabase
    .from("mafia_profiles")
    .select(mafiaProfileSelect)
    .eq("id", userId)
    .maybeSingle<MafiaProfile>();

  if (error) {
    throw error;
  }

  return data;
}

export async function ensureMafiaProfile(user: User) {
  const existingProfile = await getMafiaProfile(user.id);

  if (existingProfile) {
    return existingProfile;
  }

  const { data, error } = await supabase
    .from("mafia_profiles")
    .insert({
      avatar_url: null,
      display_name: null,
      id: user.id,
    })
    .select(mafiaProfileSelect)
    .single<MafiaProfile>();

  if (error) {
    throw error;
  }

  return data;
}

export async function saveMafiaProfile({
  avatarUrl,
  displayName,
  userId,
}: {
  avatarUrl: string;
  displayName: string;
  userId: string;
}) {
  const { data, error } = await supabase
    .from("mafia_profiles")
    .upsert({
      avatar_url: avatarUrl.trim(),
      display_name: displayName.trim(),
      id: userId,
      updated_at: new Date().toISOString(),
    })
    .select(mafiaProfileSelect)
    .single<MafiaProfile>();

  if (error) {
    throw error;
  }

  return data;
}
