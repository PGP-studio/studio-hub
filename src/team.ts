// The studio's people. Edit this when someone joins.
// `login` is their GitHub username; it decides whose Claude "Claim" assigns.
// Workers on tasks are free text like "George's Claude" or "Dev B (by hand)";
// a worker belongs to the member whose name it starts with.

export type Member = { name: string; login?: string; owns: string; bg: string; fg: string };

export const TEAM: Member[] = [
  { name: "George", login: "conx22009", owns: "Shooting, accuracy, training", bg: "#E7ECFB", fg: "#2B44A8" },
  { name: "Dev B", login: "Pexa969", owns: "Economy, guns, pets, saving", bg: "#E3F3EA", fg: "#1E6B49" },
  { name: "Dev C", login: "SneaXoX", owns: "UI, world, models, sounds", bg: "#FBEDE3", fg: "#9A4A12" },
];

export function memberForLogin(login: string): Member | undefined {
  return TEAM.find((m) => m.login?.toLowerCase() === login.toLowerCase());
}

export function memberForWorker(worker: string): Member | undefined {
  return TEAM.find((m) => worker.toLowerCase().startsWith(m.name.toLowerCase()));
}
