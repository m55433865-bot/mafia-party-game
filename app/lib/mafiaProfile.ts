import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type MafiaProfile = {
  avatar_url: string | null;
  display_name: string | null;
  games_played: number;
  games_won: number;
  id: string;
};

function getDefaultDisplayName(user: User) {
  const metadata = user.user_metadata;
  const googleName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : "";
  const emailPrefix = user.email?.split("@")[0] ?? "Player";

  return googleName || emailPrefix;
}

function getDefaultAvatarUrl(user: User) {
  const metadata = user.user_metadata;

  if (typeof metadata.avatar_url === "string") {
    return metadata.avatar_url;
  }

  if (typeof metadata.picture === "string") {
    return metadata.picture;
  }

  return null;
}

export async function getOrCreateMafiaProfile(user: User) {
  const { data: existingProfile, error: selectError } = await supabase
    .from("mafia_profiles")
    .select("id, display_name, avatar_url, games_played, games_won")
    .eq("id", user.id)
    .maybeSingle<MafiaProfile>();

  if (selectError) {
    throw selectError;
  }

  if (existingProfile) {
    return existingProfile;
  }

  const { data: createdProfile, error: insertError } = await supabase
    .from("mafia_profiles")
    .insert({
      avatar_url: getDefaultAvatarUrl(user),
      display_name: getDefaultDisplayName(user),
      id: user.id,
    })
    .select("id, display_name, avatar_url, games_played, games_won")
    .single<MafiaProfile>();

  if (insertError) {
    throw insertError;
  }

  return createdProfile;
}
