"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RoleImagePreloader } from "../components/RoleImagePreloader";
import { getRoleCard, roleNames } from "../lib/roles";

export default function RolesPage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState(roleNames[0]);
  const roleCard = getRoleCard(selectedRole);

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-8 text-white">
      <RoleImagePreloader />
      <section className="mx-auto flex w-full max-w-sm flex-col text-center">
        <button
          onClick={() => router.push("/")}
          className="mb-6 min-h-11 self-start rounded-xl border border-zinc-700 bg-zinc-900 px-4 text-sm font-bold text-zinc-100 transition hover:border-zinc-500"
          type="button"
        >
          Back
        </button>

        <p className="text-sm font-medium uppercase tracking-[0.35em] text-emerald-300">
          Mafia Party Game
        </p>
        <h1 className="mt-4 text-4xl font-bold">Roles</h1>

        <div className="mt-8 grid grid-cols-2 gap-3">
          {roleNames.map((roleName) => {
            const isSelected = selectedRole === roleName;

            return (
              <button
                key={roleName}
                onClick={() => setSelectedRole(roleName)}
                className={`min-h-12 rounded-xl border px-3 text-sm font-bold transition active:scale-[0.98] ${
                  isSelected
                    ? "border-emerald-400 bg-emerald-500/10 text-emerald-100"
                    : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-500"
                }`}
                type="button"
              >
                {roleName}
              </button>
            );
          })}
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-yellow-700/60 bg-zinc-950 p-3 text-left shadow-2xl shadow-black/30">
          <div className="rounded-xl border border-yellow-500/50 bg-zinc-900 p-3">
            <div className="rounded-lg border border-yellow-500/40 bg-yellow-950/20 px-3 py-2 text-center">
              <h2 className="text-xl font-black uppercase tracking-[0.18em] text-yellow-100">
                {roleCard.title}
              </h2>
            </div>

            <div
              className={`mt-3 aspect-[4/3] overflow-hidden rounded-lg border border-yellow-500/30 bg-gradient-to-br ${roleCard.artClassName}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                className="h-full w-full object-cover"
                src={roleCard.imageSrc}
              />
            </div>

            <div className="mt-3 rounded-lg border border-yellow-500/30 bg-zinc-950 px-3 py-3 text-yellow-50 shadow-inner shadow-black/60">
              <p className="text-sm font-black uppercase tracking-[0.12em] text-yellow-200">
                Night ability
              </p>
              <p className="mt-1 text-sm font-bold leading-6 text-zinc-100">
                {roleCard.nightAbility}
              </p>
              <p className="mt-3 text-sm font-black uppercase tracking-[0.12em] text-yellow-200">
                Win condition
              </p>
              <p className="mt-1 text-sm font-bold leading-6 text-zinc-100">
                {roleCard.winCondition}
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
