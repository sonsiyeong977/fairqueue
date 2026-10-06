import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Heart,
  Menu,
  Minus,
  Plus,
  Search,
  Ticket,
  UserRound,
  X,
} from "lucide-react";
import {
  dateLabel,
  events,
  money,
  type Event,
  type Genre,
  type Session,
  type Zone,
} from "./data";

type CatalogAvailability = {
  events: Array<{
    id: string;
    status: Event["status"];
    sessions: Array<{
      id: string;
      status: Session["status"];
      zones: Array<{ id: string; remaining: number; price: number }>;
    }>;
  }>;
};
const CatalogContext = createContext(events);
const useCatalog = () => useContext(CatalogContext);

function withAvailability(snapshot: CatalogAvailability): Event[] {
  return events.map((event) => {
    const current = snapshot.events.find((item) => item.id === event.id);
    if (!current) return event;
    return {
      ...event,
      status: current.status,
      sessions: event.sessions.map((session) => {
        const live = current.sessions.find((item) => item.id === session.id);
        if (!live) return session;
        return {
          ...session,
          status: live.status,
          zones: session.zones.map((zone) => {
            const liveZone = live.zones.find((item) => item.id === zone.id);
            return liveZone ? { ...zone, remaining: liveZone.remaining, price: liveZone.price } : zone;
          }),
        };
      }),
    };
  });
}

type DemoUser = { name: string; email: string };
const USER_KEY = "fairqueue-storefront-demo-user";
const RECENT_KEY = "fairqueue-storefront-recent";
const SAVED_KEY = "fairqueue-storefront-saved";
const BOOKINGS_KEY = "fairqueue-storefront-bookings";

type BookingRecord = {
  queueId: string;
  eventId: string;
  sessionId: string;
  status: "SETTLED" | "REFUNDED";
  quantity: number;
  grade: string | null;
  zone: string | null;
  seats: number[];
  totalKrw: number;
  txUrl: string | null;
  completedAt: string;
};

function readUser(): DemoUser | null {
  try {
    const value = localStorage.getItem(USER_KEY);
    return value ? (JSON.parse(value) as DemoUser) : null;
  } catch {
    return null;
  }
}
function readIds(key: string): string[] {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as string[]) : [];
  } catch {
    return [];
  }
}
function readBookings(key: string): BookingRecord[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function userKey(base: string, user: DemoUser) {
  return `${base}:${user.email.toLowerCase()}`;
}

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="FairQueue home">
      <span className="brand-mark">
        <Ticket size={21} strokeWidth={2.2} />
      </span>
      <span>FairQueue</span>
    </Link>
  );
}

function Header({
  user,
  onLogout,
}: {
  user: DemoUser | null;
  onLogout: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const location = useLocation();
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);
  function search(event: React.FormEvent) {
    event.preventDefault();
    navigate(`/events?q=${encodeURIComponent(query.trim())}`);
  }
  return (
    <header className="site-header">
      <div className="header-inner">
        <Brand />
        <nav
          className={`main-nav ${menuOpen ? "open" : ""}`}
          aria-label="Main navigation"
        >
          <Link to="/events">All events</Link>
          <Link to="/events?genre=Concert">Concerts</Link>
          <Link to="/events?genre=Musical">Musicals</Link>
          <Link to="/events?genre=Festival">Festivals</Link>
          <Link to="/events?sale=Opening%20soon">On sale soon</Link>
        </nav>
        <form className="header-search" onSubmit={search}>
          <Search size={17} />
          <input
            aria-label="Search events"
            placeholder="Events or artists"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <div className="header-account">
          {user ? (
            <>
              <Link to="/my" className="account-link">
                <UserRound size={17} /> My account
              </Link>
              <button className="text-button" onClick={onLogout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="account-link">
                Log in
              </Link>
              <Link to="/signup" className="join-link">
                Sign up
              </Link>
            </>
          )}
        </div>
        <button
          className="mobile-menu icon-button"
          title="Menu"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Brand />
          <p>Find a show worth seeing. Book on your terms.</p>
        </div>
        <div>
          <span>FAIRQUEUE</span>
          <Link to="/events">Explore events</Link>
          <Link to="/my">My account</Link>
        </div>
        <div>
          <span>PLEASE NOTE</span>
          <p>Events and accounts shown here are fictional prototype data.</p>
          <p>© 2026 FairQueue</p>
        </div>
      </div>
    </footer>
  );
}

function Poster({
  event,
  className = "",
}: {
  event: Event;
  className?: string;
}) {
  return (
    <div className={`poster ${className}`}>
      <img
        src={event.poster}
        alt={`Poster for ${event.title}: ${event.subtitle}`}
      />
      <div className="poster-overlay">
        <span>FAIRQUEUE PRESENTS</span>
        <strong>
          {event.title}
          <br />
          <em>{event.subtitle}</em>
        </strong>
        <small>{event.period}</small>
      </div>
    </div>
  );
}
function EventCard({ event, rank }: { event: Event; rank?: number }) {
  return (
    <Link className="event-card" to={`/events/${event.id}`}>
      <Poster event={event} />
      <div className="card-meta">
        <span className="event-genre">{event.genre}</span>
        <span
          className={`sale-text ${event.status === "OPENING_SOON" ? "soon" : ""}`}
        >
          {event.status === "OPENING_SOON" ? "Opening soon" : "On sale"}
        </span>
      </div>
      <h3>
        {rank ? (
          <span className="rank">{String(rank).padStart(2, "0")}</span>
        ) : null}
        {event.title}
      </h3>
      <p>
        {event.venue} · {event.city}
      </p>
      <p>{event.period}</p>
    </Link>
  );
}

function Home({ user }: { user: DemoUser | null }) {
  const events = useCatalog();
  const [featured, setFeatured] = useState(0);
  const event = events[featured];
  const musical = events.find((item) => item.id === "garden-of-time");
  const musicalOpeningSoon = musical?.status === "OPENING_SOON";
  const recent = user
    ? readIds(userKey(RECENT_KEY, user))
        .map((id) => events.find((item) => item.id === id))
        .filter((item): item is Event => !!item)
    : [];
  return (
    <>
      <section className="home-hero">
        <div
          className="hero-image"
          style={{ backgroundImage: `url(${event.poster})` }}
        />
        <div className="hero-shade" />
        <div className="container hero-content">
          <p className="hero-kicker">
            FEATURED PERFORMANCE <span>0{featured + 1} / 03</span>
          </p>
          <div className="hero-bottom">
            <div>
              <span className="hero-type">
                {event.genre} · {event.city}
              </span>
              <h1>
                {event.title}
                <br />
                <em>{event.subtitle}</em>
              </h1>
              <p>
                {event.period} &nbsp; / &nbsp; {event.venue}
              </p>
              <Link className="hero-cta" to={`/events/${event.id}`}>
                Explore event <ArrowRight size={18} />
              </Link>
            </div>
            <div className="hero-controls" aria-label="Choose featured event">
              {events.map((item, index) => (
                <button
                  key={item.id}
                  aria-label={`Show featured event ${index + 1}`}
                  aria-current={featured === index}
                  className={featured === index ? "selected" : ""}
                  onClick={() => setFeatured(index)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="container home-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CURATED FOR YOU</p>
            <h2>On the lineup</h2>
          </div>
          <Link className="more-link" to="/events">
            View all events <ArrowRight size={17} />
          </Link>
        </div>
        <div className="event-grid">
          {events.map((item, i) => (
            <EventCard key={item.id} event={item} rank={i + 1} />
          ))}
        </div>
      </section>
      <section className="opening-band">
        <div className="container opening-inner">
          <div>
            <p className="eyebrow">{musicalOpeningSoon ? "TICKET OPEN" : "NOW BOOKING"}</p>
            <h2>{musicalOpeningSoon ? "A new story opens soon." : "The story is now booking."}</h2>
            <p>The Garden of Time · {musicalOpeningSoon ? "Oct 9, 2:00 PM KST" : "Performances from Nov 5"}</p>
          </div>
          <Link to="/events/garden-of-time">
            View on-sale details <ArrowRight size={18} />
          </Link>
        </div>
      </section>
      {recent.length > 0 && (
        <section className="container home-section recent-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR HISTORY</p>
              <h2>Recently viewed</h2>
            </div>
            <Link className="more-link" to="/my">
              My account <ArrowRight size={17} />
            </Link>
          </div>
          <div className="event-grid">
            {recent.slice(0, 3).map((item) => (
              <EventCard key={item.id} event={item} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const genres: Array<"All" | Genre> = ["All", "Concert", "Musical", "Festival"];
function EventsPage() {
  const events = useCatalog();
  const [params, setParams] = useSearchParams();
  const genre = params.get("genre") || "All";
  const q = params.get("q") || "";
  const city = params.get("city") || "All";
  const sale = params.get("sale") || "All";
  const date = params.get("date") || "All";
  const [searchTerm, setSearchTerm] = useState(q);
  useEffect(() => {
    setSearchTerm(q);
  }, [q]);
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === "All") next.delete(key);
    else next.set(key, value);
    setParams(next);
  }
  const now = new Date();
  const targetMonth = date === "Next month" ? now.getMonth() + 1 : now.getMonth();
  const targetYear = now.getFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = targetMonth % 12;
  const filtered = events.filter(
    (event) =>
      (genre === "All" || event.genre === genre) &&
      (city === "All" || event.city === city) &&
      (sale === "All" ||
        (sale === "On sale"
          ? event.status === "ON_SALE"
          : event.status === "OPENING_SOON")) &&
      (date === "All" ||
        event.sessions.some((session) => {
          const day = new Date(`${session.date}T12:00:00+09:00`);
          return (
            day.getFullYear() === targetYear &&
            day.getMonth() === normalizedMonth
          );
        })) &&
      (!q ||
        `${event.title} ${event.artist} ${event.venue}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );
  return (
    <main className="container catalog">
      <div className="page-title">
        <p className="eyebrow">FIND YOUR NEXT SHOW</p>
        <h1>Explore events</h1>
        <p>Find your next night out.</p>
      </div>
      <div className="catalog-tools">
        <form
          className="catalog-search"
          onSubmit={(e) => {
            e.preventDefault();
            update("q", searchTerm.trim());
          }}
        >
          <Search size={19} />
          <input
            aria-label="Search events"
            placeholder="Search events, artists, or venues"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <button type="submit">Search</button>
        </form>
        <div className="filter-row">
          <div className="filter-chips" aria-label="Choose a genre">
            {genres.map((item) => (
              <button
                key={item}
                className={genre === item ? "active" : ""}
                onClick={() => update("genre", item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="filter-selects">
            <label>
              Date{" "}
              <select
                value={date}
                onChange={(e) => update("date", e.target.value)}
              >
                <option>All</option>
                <option>This month</option>
                <option>Next month</option>
              </select>
            </label>
            <label>
              Region{" "}
              <select
                value={city}
                onChange={(e) => update("city", e.target.value)}
              >
                <option>All</option>
                <option>Seoul</option>
                <option>Gyeonggi</option>
              </select>
            </label>
            <label>
              Availability{" "}
              <select
                value={sale}
                onChange={(e) => update("sale", e.target.value)}
              >
                <option>All</option>
                <option>On sale</option>
                <option>Opening soon</option>
              </select>
            </label>
          </div>
        </div>
      </div>
      <div className="results-count">
        <strong>{filtered.length}</strong> {filtered.length === 1 ? "event" : "events"} found
      </div>
      {filtered.length ? (
        <div className="event-grid catalog-grid">
          {filtered.map((item) => (
            <EventCard key={item.id} event={item} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Search size={28} />
          <h2>No events found</h2>
          <p>Try a different search or filter.</p>
          <button onClick={() => setParams({})}>Clear filters</button>
        </div>
      )}
    </main>
  );
}

function SeatMap({
  zones,
  selected,
  onSelect,
}: {
  zones: Zone[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="seat-map-wrap">
      <div className="seat-map-head">
        <span>STAGE</span>
        <span>Seating zones</span>
      </div>
      <div className="seat-map" role="group" aria-label="Choose a seating zone">
        {zones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className={`map-zone ${zone.shape} grade-${zone.grade.toLowerCase()} ${selected === zone.id ? "is-selected" : ""} ${zone.remaining === 0 ? "is-soldout" : ""}`}
            onClick={() => onSelect(zone.id)}
            aria-pressed={selected === zone.id}
            title={`${zone.label}: ${money(zone.price)}, ${zone.remaining} seats left`}
          >
            <span>{zone.label}</span>
          </button>
        ))}
      </div>
      <div className="map-legend">
        <span>
          <i className="legend-vip" /> VIP
        </span>
        <span>
          <i className="legend-r" /> R
        </span>
        <span>
          <i className="legend-s" /> S
        </span>
        <span>
          <i className="legend-a" /> A
        </span>
        <span>
          <i className="legend-sold" /> Sold out
        </span>
      </div>
    </div>
  );
}

function Detail({ user }: { user: DemoUser | null }) {
  const events = useCatalog();
  const { eventId } = useParams();
  const navigate = useNavigate();
  const event = events.find((item) => item.id === eventId);
  const [sessionId, setSessionId] = useState("");
  const [count, setCount] = useState(1);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("Overview");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setSessionId("");
    setCount(1);
    setSelectedZone(null);
    if (user && event) {
      const key = userKey(RECENT_KEY, user);
      localStorage.setItem(
        key,
        JSON.stringify(
          [event.id, ...readIds(key).filter((id) => id !== event.id)].slice(
            0,
            10,
          ),
        ),
      );
      setSaved(readIds(userKey(SAVED_KEY, user)).includes(event.id));
    }
  }, [event?.id, user?.email]);
  if (!event)
    return (
      <main className="container not-found">
        <h1>Event not found</h1>
        <Link to="/events">
          Browse events <ArrowRight size={18} />
        </Link>
      </main>
    );
  const session = event.sessions.find((item) => item.id === sessionId);
  const available =
    session &&
    event.status === "ON_SALE" &&
    new Date() >= new Date(event.saleOpens) &&
    session.status !== "SOLD_OUT" &&
    session.status !== "OPENING_SOON" &&
    session.zones.some((zone) => zone.remaining >= count);
  function selectSession(id: string) {
    setSessionId(id);
    setSelectedZone(null);
  }
  function toggleSave() {
    if (!user) {
      navigate("/login", { state: { returnTo: `/events/${event!.id}` } });
      return;
    }
    const key = userKey(SAVED_KEY, user);
    const next = saved
      ? readIds(key).filter((id) => id !== event!.id)
      : [event!.id, ...readIds(key)];
    localStorage.setItem(key, JSON.stringify(next));
    setSaved(!saved);
  }
  function book() {
    if (!session || !available) return;
    const payload = {
      eventId: event!.id,
      sessionId: session.id,
      quantity: count,
      preferredZoneId: selectedZone,
      createdAt: new Date().toISOString(),
    };
    sessionStorage.setItem("fairqueue-booking-intent", JSON.stringify(payload));
    if (!user) {
      navigate("/login", {
        state: { returnTo: `/events/${event!.id}/booking` },
      });
      return;
    }
    navigate(`/events/${event!.id}/booking`, { state: { intent: payload } });
  }
  const tabItems = ["Overview", "Seating & prices", "Booking guide"];
  return (
    <main className="container detail">
      <div className="breadcrumbs">
        <Link to="/events">All events</Link>
        <span>/</span>
        <span>{event.genre}</span>
      </div>
      <section className="detail-hero">
        <Poster event={event} className="detail-poster" />
        <div className="detail-info">
          <div className="detail-kicker">
            <span>{event.genre}</span>
            <span
              className={event.status === "OPENING_SOON" ? "soon" : "sale-text"}
            >
              {event.status === "OPENING_SOON" ? "Opening soon" : "On sale"}
            </span>
          </div>
          <h1>
            {event.title}
            <br />
            <em>{event.subtitle}</em>
          </h1>
          <p className="detail-intro">{event.intro}</p>
          <dl className="fact-list">
            <div>
              <dt>Artist</dt>
              <dd>{event.artist}</dd>
            </div>
            <div>
              <dt>Dates</dt>
              <dd>{event.period}</dd>
            </div>
            <div>
              <dt>Venue</dt>
              <dd>
                {event.venue} · {event.city}
              </dd>
            </div>
            <div>
              <dt>On sale</dt>
              <dd>
                {new Intl.DateTimeFormat("en-US", {
                  timeZone: "Asia/Seoul",
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true,
                }).format(new Date(event.saleOpens))} KST
              </dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>{event.runtime}</dd>
            </div>
            <div>
              <dt>Age guidance</dt>
              <dd>{event.age}</dd>
            </div>
          </dl>
          <div className="detail-price">
            <span>Tickets from</span>
            <strong>
              {money(Math.min(...event.sessions[0].zones.map((z) => z.price)))}
            </strong>
          </div>
          <button
            className={`save-button ${saved ? "saved" : ""}`}
            type="button"
            onClick={toggleSave}
          >
            <Heart size={19} fill={saved ? "currentColor" : "none"} />{" "}
            {saved ? "Saved" : "Save event"}
          </button>
        </div>
      </section>
      <section className="detail-content">
        <div className="detail-main">
          <div className="tabs" role="tablist" aria-label="Event details">
            {tabItems.map((item) => (
              <button
                key={item}
                role="tab"
                aria-selected={activeTab === item}
                className={activeTab === item ? "active" : ""}
                onClick={() => setActiveTab(item)}
              >
                {item}
              </button>
            ))}
          </div>
          {activeTab === "Overview" && (
            <div className="tab-panel intro-panel">
              <p className="eyebrow">ABOUT THE SHOW</p>
              <h2>{event.subtitle}</h2>
              <p>{event.description}</p>
              <div className="show-facts">
                <div>
                  <span>ARTIST</span>
                  <strong>{event.artist}</strong>
                </div>
                <div>
                  <span>VENUE</span>
                  <strong>{event.venue}</strong>
                </div>
                <div>
                  <span>RUNNING TIME</span>
                  <strong>{event.runtime}</strong>
                </div>
              </div>
              <div className="story-image">
                <img src={event.poster} alt={`Artwork for ${event.title}`} />
              </div>
            </div>
          )}
          {activeTab === "Seating & prices" && (
            <div className="tab-panel">
              <div className="panel-heading">
                <p className="eyebrow">VENUE GUIDE</p>
                <h2>Seating guide</h2>
                <p>
                  Select a zone to see its location and price. Seats are not
                  assigned on this page.
                </p>
              </div>
              {event.genre === "Festival" ? (
                <div className="festival-zone">
                  General admission · No assigned seating
                </div>
              ) : (
                <SeatMap
                  zones={session?.zones ?? event.sessions[0].zones}
                  selected={selectedZone}
                  onSelect={setSelectedZone}
                />
              )}
              {selectedZone && (
                <div className="selected-zone">
                  {(session?.zones ?? event.sessions[0].zones)
                    .filter((z) => z.id === selectedZone)
                    .map((zone) => (
                      <div key={zone.id}>
                        <strong>{zone.label}</strong>
                        <span>{zone.view}</span>
                        <b>{money(zone.price)}</b>
                        <small>{zone.remaining} seats left for this show</small>
                      </div>
                    ))}
                </div>
              )}
              <div className="zone-list">
                {(session?.zones ?? event.sessions[0].zones).map((zone) => (
                  <div key={zone.id}>
                    <span
                      className={`zone-dot grade-${zone.grade.toLowerCase()}`}
                    />
                    <strong>{zone.label}</strong>
                    <span>{zone.view}</span>
                    <b>{money(zone.price)}</b>
                  </div>
                ))}
              </div>
            </div>
          )}
          {activeTab === "Booking guide" && (
            <div className="tab-panel guide-panel">
              <p className="eyebrow">BOOKING GUIDE</p>
              <h2>Booking information</h2>
              <div>
                <h3>Ticket limit</h3>
                <p>
                  Up to {event.maxTickets} tickets per person, per performance.
                </p>
              </div>
              <div>
                <h3>Seat assignment</h3>
                <p>
                  The map is a guide to zones and prices. Seat availability
                  would be confirmed during booking.
                </p>
              </div>
              <div>
                <h3>Cancellations & refunds</h3>
                <p>
                  These are fictional events for a product prototype. No real
                  payment, cancellation, or refund policy applies.
                </p>
              </div>
            </div>
          )}
        </div>
        <aside className="booking-panel">
          <div className="booking-panel-head">
            <p className="eyebrow">BOOK YOUR MOMENT</p>
            <h2>Choose your tickets</h2>
          </div>
          <div className="booking-field">
            <label>
              <CalendarDays size={17} /> Date & performance
            </label>
            <div className="session-list">
              {event.sessions.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={sessionId === item.id ? "chosen" : ""}
                  onClick={() => selectSession(item.id)}
                >
                  <span>
                    {dateLabel(item.date)} <b>{item.time}</b>
                  </span>
                  <small className={item.status === "SOLD_OUT" ? "sold" : ""}>
                    {event.status === "OPENING_SOON"
                      ? "Opening soon"
                      : item.status === "SOLD_OUT"
                        ? "Sold out"
                        : item.status === "LIMITED"
                          ? "Limited seats"
                          : "Available"}
                  </small>
                </button>
              ))}
            </div>
          </div>
          <div className="booking-field">
            <label>
              <Ticket size={17} /> Tickets{" "}
              <small>Max {event.maxTickets} per person</small>
            </label>
            <div className="quantity">
              <button
                aria-label="Decrease ticket quantity"
                onClick={() => setCount(Math.max(1, count - 1))}
                disabled={count <= 1}
              >
                <Minus size={18} />
              </button>
              <output>{count}</output>
              <button
                aria-label="Increase ticket quantity"
                onClick={() => setCount(Math.min(event.maxTickets, count + 1))}
                disabled={count >= event.maxTickets}
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
          {session && (
            <div className="booking-availability">
              <span>Selected performance</span>
              <strong>
                {event.status === "OPENING_SOON"
                  ? "Opening soon"
                  : session.status === "SOLD_OUT"
                    ? "Sold out"
                    : `${session.zones.reduce((sum, zone) => sum + zone.remaining, 0)} seats left`}
              </strong>
            </div>
          )}
          <button className="book-button" disabled={!available} onClick={book}>
            {event.status === "OPENING_SOON"
              ? "Tickets on sale soon"
              : !session
                ? "Select a performance"
                : available
                  ? "Continue to booking"
                  : "Unavailable for this selection"}{" "}
            {available && <ArrowRight size={19} />}
          </button>
          <p className="panel-note">Seat counts shown here are prototype data.</p>
        </aside>
      </section>
    </main>
  );
}

function Auth({
  mode,
  onLogin,
}: {
  mode: "login" | "signup";
  onLogin: (user: DemoUser) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo =
    (location.state as { returnTo?: string } | null)?.returnTo || "/my";
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const localName = mode === "signup" ? name.trim() : email.split("@")[0];
    if (!localName || !email.includes("@") || password.length < 6) return;
    onLogin({ name: localName, email: email.trim() });
    navigate(returnTo);
  }
  return (
    <main className="auth-page">
      <div className="auth-card">
        <Brand />
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1>
          {mode === "login"
            ? "Welcome back."
            : "Your next show starts here."}
        </h1>
        <p>Keep your saved events and recently viewed shows in one place.</p>
        <form onSubmit={submit}>
          {mode === "signup" && (
            <label>
              Name
              <input
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </label>
          )}
          <label>
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <input
              required
              minLength={6}
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </label>
          <button className="book-button" type="submit">
            {mode === "login" ? "Continue with demo account" : "Create demo account"}{" "}
            <ArrowRight size={18} />
          </button>
        </form>
        <p className="auth-switch">
          {mode === "login" ? "New here?" : "Already have an account?"}{" "}
          <Link
            to={mode === "login" ? "/signup" : "/login"}
            state={{ returnTo }}
          >
            {mode === "login" ? "Sign up" : "Log in"}
          </Link>
        </p>
        <p className="auth-disclaimer">
          Demo profiles are stored only in this browser. Passwords are not
          verified or saved, and no payment is processed.
        </p>
      </div>
    </main>
  );
}

function MyPage({ user }: { user: DemoUser | null }) {
  const events = useCatalog();
  if (!user)
    return <Navigate to="/login" state={{ returnTo: "/my" }} replace />;
  const recent = readIds(userKey(RECENT_KEY, user))
    .map((id) => events.find((event) => event.id === id))
    .filter((event): event is Event => !!event);
  const saved = readIds(userKey(SAVED_KEY, user))
    .map((id) => events.find((event) => event.id === id))
    .filter((event): event is Event => !!event);
  const bookings = readBookings(userKey(BOOKINGS_KEY, user));
  return (
    <main className="container my-page">
      <div className="page-title">
        <p className="eyebrow">MY FAIRQUEUE</p>
        <h1>{user.name}'s FairQueue</h1>
        <p>{user.email}</p>
      </div>
      <section>
        <div className="section-heading">
          <h2>My bookings</h2>
        </div>
        {bookings.length ? (
          <div className="booking-history">
            {bookings.map((booking) => {
              const event = events.find((item) => item.id === booking.eventId);
              const session = event?.sessions.find((item) => item.id === booking.sessionId);
              return (
                <article className="booking-record" key={booking.queueId}>
                  <div>
                    <span className="eyebrow">{booking.status === "SETTLED" ? "DEVNET SETTLED" : "DEVNET REFUNDED"}</span>
                    <h3>{event?.title || booking.eventId}</h3>
                    <p>{session ? `${session.date} · ${session.time}` : booking.sessionId} · {booking.quantity} ticket{booking.quantity === 1 ? "" : "s"}</p>
                    {booking.zone && <p>{booking.zone}{booking.seats.length ? ` · Seats ${booking.seats.join(", ")}` : ""}</p>}
                  </div>
                  <div className="booking-record-end">
                    <strong>{booking.status === "SETTLED" ? money(booking.totalKrw) : "Refunded"}</strong>
                    {booking.txUrl?.startsWith("https://explorer.solana.com/tx/") && (
                      <a href={booking.txUrl} target="_blank" rel="noopener noreferrer">View Devnet transaction <ArrowRight size={15} /></a>
                    )}
                  </div>
                </article>
              );
            })}
            <p className="booking-history-note">Demo activity saved on this browser only. These are Devnet transactions, not issued tickets.</p>
          </div>
        ) : (
          <div className="empty-state compact">
            <Ticket size={28} />
            <h3>No bookings yet</h3>
            <p>Explore events and choose a performance to get started.</p>
            <Link to="/events">
              Explore events <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </section>
      {saved.length > 0 && (
        <section>
          <div className="section-heading">
            <h2>Saved events</h2>
          </div>
          <div className="event-grid">
            {saved.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}
      {recent.length > 0 && (
        <section>
          <div className="section-heading">
            <h2>Recently viewed</h2>
          </div>
          <div className="event-grid">
            {recent.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function BookingHandoff({ user }: { user: DemoUser | null }) {
  const events = useCatalog();
  const { eventId } = useParams();
  const navigate = useNavigate();
  const event = events.find((item) => item.id === eventId);
  const intent = useMemo(() => {
    try {
      const saved = sessionStorage.getItem("fairqueue-booking-intent");
      return saved
        ? (JSON.parse(saved) as {
            eventId: string;
            sessionId: string;
            quantity: number;
            preferredZoneId: string | null;
          })
        : null;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    if (user && event && intent?.eventId === eventId) {
      sessionStorage.setItem("fairqueue-booking-intent", JSON.stringify({ ...intent, userEmail: user.email }));
      window.location.replace("/dashboard/portal.html");
    }
  }, [user, event, intent, eventId]);
  if (!event || !intent || intent.eventId !== eventId)
    return (
      <main className="container not-found">
        <h1>Booking details not found</h1>
        <Link to={`/events/${eventId || ""}`}>Back to event details</Link>
      </main>
    );
  if (!user)
    return (
      <Navigate
        to="/login"
        state={{ returnTo: `/events/${eventId}/booking` }}
        replace
      />
    );
  return (
    <main className="handoff">
      <div className="container handoff-inner">
        <button
          className="back-link"
          onClick={() => navigate(`/events/${eventId}`)}
        >
          <ArrowLeft size={18} /> Back to event
        </button>
        <div className="handoff-card">
          <p className="eyebrow">FAIRQUEUE BOOKING</p>
          <h1>Opening your booking session</h1>
          <p>
            {event.title} · {event.subtitle}
          </p>
          <a className="handoff-button" href="/dashboard/portal.html">
            Continue to booking <ArrowRight size={18} />
          </a>
        </div>
      </div>
    </main>
  );
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
export default function App() {
  const [user, setUser] = useState<DemoUser | null>(readUser);
  const [catalogEvents, setCatalogEvents] = useState(events);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/catalog/events");
        if (!response.ok) return;
        const snapshot = (await response.json()) as CatalogAvailability;
        if (active) setCatalogEvents(withAvailability(snapshot));
      } catch {
        // The static catalog remains available if the platform API is offline.
      }
    }
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);
  function login(next: DemoUser) {
    localStorage.setItem(USER_KEY, JSON.stringify(next));
    setUser(next);
  }
  function logout() {
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }
  return (
    <CatalogContext.Provider value={catalogEvents}>
      <ScrollTop />
      <Header user={user} onLogout={logout} />
      <Routes>
        <Route path="/" element={<Home user={user} />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/:eventId" element={<Detail user={user} />} />
        <Route
          path="/events/:eventId/booking"
          element={<BookingHandoff user={user} />}
        />
        <Route path="/login" element={<Auth mode="login" onLogin={login} />} />
        <Route
          path="/signup"
          element={<Auth mode="signup" onLogin={login} />}
        />
        <Route path="/my" element={<MyPage user={user} />} />
        <Route
          path="*"
          element={
            <main className="container not-found">
              <h1>Page not found</h1>
              <Link to="/">
                Back to home <ArrowRight size={18} />
              </Link>
            </main>
          }
        />
      </Routes>
      <Footer />
    </CatalogContext.Provider>
  );
}
