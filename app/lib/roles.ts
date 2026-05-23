export type RoleCard = {
  artClassName: string;
  imageLabel: string;
  imageSrc: string;
  nightAbility: string;
  title: string;
  winCondition: string;
};

export const roleNames = [
  "Detective",
  "Doctor",
  "Mafia",
  "Villager",
  "Vigilante",
  "Cupid",
  "Jester",
  "Mafia Jester",
];

export function getRoleCard(role: string): RoleCard {
  if (role === "Mafia") {
    return {
      artClassName: "from-red-950 via-zinc-950 to-red-700",
      imageLabel: "M",
      imageSrc: "/roles/mafia.png",
      nightAbility: "Choose one player to attack.",
      title: "Mafia",
      winCondition: "Equal or outnumber the villagers.",
    };
  }

  if (role === "Doctor") {
    return {
      artClassName: "from-emerald-950 via-zinc-950 to-emerald-600",
      imageLabel: "D",
      imageSrc: "/roles/doctor.png",
      nightAbility: "Choose one player to protect.",
      title: "Doctor",
      winCondition: "Eliminate all Mafia.",
    };
  }

  if (role === "Detective") {
    return {
      artClassName: "from-sky-950 via-zinc-950 to-blue-600",
      imageLabel: "I",
      imageSrc: "/roles/detective.png",
      nightAbility: "Check one player's party.",
      title: "Detective",
      winCondition: "Eliminate all Mafia.",
    };
  }

  if (role === "Vigilante") {
    return {
      artClassName: "from-orange-950 via-zinc-950 to-red-600",
      imageLabel: "VG",
      imageSrc: "/roles/vigilante.png",
      nightAbility:
        "One bullet. Kill a suspect, but die of guilt if they are innocent.",
      title: "Vigilante",
      winCondition: "Eliminate all Mafia.",
    };
  }

  if (role === "Cupid") {
    return {
      artClassName: "from-pink-950 via-zinc-950 to-rose-500",
      imageLabel: "C",
      imageSrc: "/roles/cupid.png",
      nightAbility:
        "One time: link two lovers. If one dies, the other dies too.",
      title: "Cupid",
      winCondition: "Eliminate all Mafia.",
    };
  }

  if (role === "Jester") {
    return {
      artClassName: "from-purple-950 via-zinc-950 to-fuchsia-600",
      imageLabel: "J",
      imageSrc: "/roles/jester.png",
      nightAbility: "Passive: Detective sees you as Mafia.",
      title: "Jester",
      winCondition: "Get voted out.",
    };
  }

  if (role === "Mafia Jester") {
    return {
      artClassName: "from-red-950 via-zinc-950 to-purple-700",
      imageLabel: "MJ",
      imageSrc: "/roles/mafia-jester.png",
      nightAbility: "Act with Mafia at night.",
      title: "Mafia Jester",
      winCondition: "Eliminate villagers.",
    };
  }

  return {
    artClassName: "from-amber-950 via-zinc-950 to-yellow-600",
    imageLabel: "V",
    imageSrc: "/roles/villager.png",
    nightAbility: "No night ability.",
    title: "Villager",
    winCondition: "Eliminate all Mafia.",
  };
}
