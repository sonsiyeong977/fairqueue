import catalog from "../catalog.json";

export type Genre = "Concert" | "Musical" | "Festival";
export type Zone = {
  id: string;
  label: string;
  grade: string;
  price: number;
  capacity: number;
  remaining: number;
  view: string;
  shape: string;
};
export type Session = {
  id: string;
  date: string;
  time: string;
  status: "AVAILABLE" | "LIMITED" | "SOLD_OUT" | "OPENING_SOON";
  zones: Zone[];
};
export type Event = {
  id: string;
  title: string;
  subtitle: string;
  genre: Genre;
  artist: string;
  venue: string;
  city: string;
  period: string;
  runtime: string;
  age: string;
  poster: string;
  intro: string;
  description: string;
  saleOpens: string;
  status: "ON_SALE" | "OPENING_SOON";
  maxTickets: number;
  sessions: Session[];
};

export const events: Event[] = catalog.map((event) => ({
  ...event,
  genre: event.genre as Genre,
  status: event.status as Event["status"],
  sessions: event.sessions.map((session) => ({
    ...session,
    status: session.status as Session["status"],
  })),
}));

export const money = (value: number) => `KRW ${value.toLocaleString("en-US")}`;
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(`${date}T12:00:00+09:00`));
