export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-5xl font-bold">Mafia Party Game</h1>

      <p className="text-zinc-400 text-center max-w-md">
        Play Mafia with your friends directly from your phones.
      </p>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button className="bg-white text-black py-3 rounded-xl font-semibold">
          Create Room
        </button>

        <button className="border border-zinc-700 py-3 rounded-xl font-semibold">
          Join Room
        </button>
      </div>
    </main>
  );
}