import { type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ArrowLeftRight, Heart, Search, X } from 'lucide-react';

const queryClient = new QueryClient();
const API = 'https://pokeapi.co/api/v2';
const STAT_NAMES = ['HP', 'Attack', 'Defense', 'Special Attack', 'Special Defense', 'Speed'];
const STAT_KEYS = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];
const TYPE_COLORS: Record<string, string> = {
  normal: '#8b8a70', fire: '#e46c45', water: '#548ec8', electric: '#d5aa29',
  grass: '#62a06e', ice: '#64aeb3', fighting: '#be5b4e', poison: '#9566a4',
  ground: '#bb9254', flying: '#8198c8', psychic: '#d36991', bug: '#88a344',
  rock: '#a99b64', ghost: '#726796', dragon: '#7565c7', dark: '#655c57',
  steel: '#8899a4', fairy: '#ce83a1',
};

type Pokemon = {
  id: number;
  name: string;
  height: number;
  weight: number;
  sprites: { other?: { 'official-artwork'?: { front_default?: string | null } }; front_default?: string | null };
  types: { slot: number; type: { name: string } }[];
  stats: { base_stat: number; stat: { name: string } }[];
};

type EvoNode = { species: { name: string; url: string }; evolves_to: EvoNode[] };
type EvolutionEntry = {
  name: string;
  id: number;
  pokemon: Pokemon;
  children: EvolutionEntry[];
};

async function getPokemon(query: string): Promise<Pokemon> {
  const normalized = query.trim().toLowerCase().replace(/^#/, '');
  if (!normalized) throw new Error('Type a Pokémon name or Pokédex number to begin.');
  const response = await fetch(`${API}/pokemon/${encodeURIComponent(normalized)}`);
  if (response.status === 404) throw new Error(`We couldn't find “${query.trim()}”. Try an English name or Pokédex number.`);
  if (!response.ok) throw new Error('The PokéAPI is having a moment. Please try again.');
  return response.json();
}

function artwork(mon?: Pokemon | null) {
  return mon?.sprites.other?.['official-artwork']?.front_default || mon?.sprites.front_default || '';
}

function dexId(id: number) {
  return `#${String(id).padStart(3, '0')}`;
}

function typeColor(name: string) {
  return TYPE_COLORS[name] || '#72808a';
}

function getStat(mon: Pokemon, key: string) {
  return mon.stats.find((entry) => entry.stat.name === key)?.base_stat ?? 0;
}

async function loadEvolutionTree(node: EvoNode): Promise<EvolutionEntry> {
  const id = Number(node.species.url.split('/').filter(Boolean).pop());
  const [pokemon, children] = await Promise.all([
    getPokemon(String(id)),
    Promise.all(node.evolves_to.map(loadEvolutionTree)),
  ]);
  return { name: node.species.name, id, pokemon, children };
}

function EvolutionNodeCard({
  entry,
  activeId,
  onChoose,
}: {
  entry: EvolutionEntry;
  activeId: number;
  onChoose: (name: string) => void;
}) {
  return (
    <div className="evo-branch" data-testid={`branch-evolution-${entry.id}`}>
      <button
        className={`evo-item ${entry.id === activeId ? 'is-current' : ''}`}
        onClick={() => onChoose(entry.name)}
        data-testid={`button-evolution-${entry.name}`}
        aria-label={`Explore ${entry.name}`}
        aria-current={entry.id === activeId ? 'true' : undefined}
      >
        {artwork(entry.pokemon) && <img src={artwork(entry.pokemon)} alt="" />}
        <strong>{entry.name}</strong>
        <span>{dexId(entry.id)}</span>
      </button>
      {entry.children.length > 0 && (
        <div className="evo-children">
          {entry.children.map((child) => (
            <div className="evo-child-row" key={child.id}>
              <span className="evo-arrow" aria-hidden="true">→</span>
              <EvolutionNodeCard entry={child} activeId={activeId} onChoose={onChoose} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function useStoredFavorites() {
  const [ids, setIds] = useState<number[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('fieldguide-favorites') || '[]');
      return Array.isArray(parsed) ? parsed.filter((id) => Number.isInteger(id)) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem('fieldguide-favorites', JSON.stringify(ids));
  }, [ids]);
  return [ids, setIds] as const;
}

function Home() {
  const [pokemon, setPokemon] = useState<Pokemon | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [evolutions, setEvolutions] = useState<EvolutionEntry | null>(null);
  const [evoLoading, setEvoLoading] = useState(false);
  const [favorites, setFavorites] = useStoredFavorites();
  const [favoriteMons, setFavoriteMons] = useState<Pokemon[]>([]);
  const [compareA, setCompareA] = useState<Pokemon | null>(null);
  const [compareB, setCompareB] = useState<Pokemon | null>(null);
  const [compareQueryA, setCompareQueryA] = useState('');
  const [compareQueryB, setCompareQueryB] = useState('');
  const [compareError, setCompareError] = useState('');
  const requestId = useRef(0);

  async function loadPokemon(search: string) {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const result = await getPokemon(search);
      if (currentRequest !== requestId.current) return;
      setPokemon(result);
      setQuery(result.name);
    } catch (caught) {
      if (currentRequest === requestId.current) setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.');
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadPokemon('bulbasaur');
    void getPokemon('charmander').then(setCompareA).catch(() => undefined);
    void getPokemon('squirtle').then(setCompareB).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!pokemon) return;
    let cancelled = false;
    setEvolutions(null);
    setEvoLoading(true);
    async function loadEvolutions() {
      try {
        const speciesResponse = await fetch(`${API}/pokemon-species/${pokemon!.id}`);
        if (!speciesResponse.ok) throw new Error();
        const species = await speciesResponse.json();
        const chainResponse = await fetch(species.evolution_chain.url);
        if (!chainResponse.ok) throw new Error();
        const chainData = await chainResponse.json();
        const tree = await loadEvolutionTree(chainData.chain);
        if (!cancelled) setEvolutions(tree);
      } catch {
        if (!cancelled) setEvolutions(null);
      } finally {
        if (!cancelled) setEvoLoading(false);
      }
    }
    void loadEvolutions();
    return () => { cancelled = true; };
  }, [pokemon?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!favorites.length) {
      setFavoriteMons([]);
      return;
    }
    Promise.all(favorites.map(async (id) => {
      try { return await getPokemon(String(id)); } catch { return null; }
    })).then((items) => {
      if (!cancelled) setFavoriteMons(items.filter((item): item is Pokemon => !!item));
    });
    return () => { cancelled = true; };
  }, [favorites.join(',')]);

  function toggleFavorite(mon: Pokemon) {
    setFavorites((previous) => previous.includes(mon.id)
      ? previous.filter((id) => id !== mon.id)
      : [...previous, mon.id]);
  }

  async function submitCompare(which: 'a' | 'b') {
    const search = which === 'a' ? compareQueryA : compareQueryB;
    setCompareError('');
    try {
      const result = await getPokemon(search);
      if (which === 'a') { setCompareA(result); setCompareQueryA(''); }
      else { setCompareB(result); setCompareQueryB(''); }
    } catch (caught) {
      setCompareError(caught instanceof Error ? caught.message : 'Could not load that Pokémon.');
    }
  }

  const isFavorite = pokemon ? favorites.includes(pokemon.id) : false;
  const compareReady = !!compareA && !!compareB;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" data-testid="text-brand"><span className="brand-mark" aria-hidden="true" /> FIELD NOTES <span style={{ color: '#d94e43' }}>/</span> POKÉDEX</div>
        <div className="top-note">A personal guide to the Pokémon world</div>
      </header>
      <main className="page-wrap">
        <section className="intro">
          <div>
            <div className="eyebrow">Your field guide · National Pokédex</div>
            <h1>Find your next <span>favorite.</span></h1>
          </div>
          <p>Look closer, learn the details, and keep a little record of the Pokémon that stay with you.</p>
        </section>

        <form className="searchbar" onSubmit={(event) => { event.preventDefault(); void loadPokemon(query); }}>
          <Search size={18} color="#8f8b82" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or Pokédex number…" aria-label="Search Pokémon by English name or Pokédex number" data-testid="input-pokemon-search" />
          <button className="action-button" type="submit" data-testid="button-search-pokemon">Explore</button>
        </form>

        {error && <div className="message error" role="alert" data-testid="status-search-error">{error}</div>}
        {loading && <div className="panel skeleton hero-skeleton" data-testid="status-pokemon-loading" aria-label="Loading Pokémon details" />}

        {!loading && pokemon && (
          <div className="layout-grid">
            <section>
              <article className="panel hero-card" data-testid={`card-pokemon-${pokemon.id}`}>
                <div className="hero-copy">
                  <div className="number" data-testid={`text-pokemon-number-${pokemon.id}`}>NATIONAL DEX &nbsp; {dexId(pokemon.id)}</div>
                  <h2 className="pokemon-title" data-testid={`text-pokemon-name-${pokemon.id}`}>{pokemon.name}</h2>
                  <div className="type-list" data-testid={`list-pokemon-types-${pokemon.id}`}>
                    {pokemon.types.map(({ type }) => <span key={type.name} className="type-pill" style={{ backgroundColor: typeColor(type.name) }} data-testid={`badge-type-${type.name}`}>{type.name}</span>)}
                  </div>
                  <div className="measurements">
                    <div><strong data-testid={`text-pokemon-height-${pokemon.id}`}>{(pokemon.height / 10).toFixed(1)} m</strong><span>Height</span></div>
                    <div><strong data-testid={`text-pokemon-weight-${pokemon.id}`}>{(pokemon.weight / 10).toFixed(1)} kg</strong><span>Weight</span></div>
                  </div>
                  <button className={`fav-toggle ${isFavorite ? 'is-fav' : ''}`} onClick={() => toggleFavorite(pokemon)} data-testid={isFavorite ? 'button-remove-favorite' : 'button-add-favorite'} aria-pressed={isFavorite}>
                    <Heart size={15} fill={isFavorite ? 'currentColor' : 'none'} /> {isFavorite ? 'In your favorites' : 'Add to favorites'}
                  </button>
                </div>
                <div className="art-stage">
                  {artwork(pokemon) && <img src={artwork(pokemon)} alt={`Official artwork of ${pokemon.name}`} data-testid={`img-pokemon-artwork-${pokemon.id}`} />}
                </div>
              </article>

              <section className="panel stat-panel" aria-label="Base stats">
                <div className="section-head">
                  <div><div className="eyebrow">At a glance</div><h2>Base stats</h2></div>
                  <span className="micro" data-testid={`text-stat-total-${pokemon.id}`}>TOTAL {pokemon.stats.reduce((sum, stat) => sum + stat.base_stat, 0)}</span>
                </div>
                <div className="stat-list">
                  {STAT_KEYS.map((key, index) => {
                    const value = getStat(pokemon, key);
                    return <div className="stat-row" key={key} data-testid={`row-stat-${key}-${pokemon.id}`}>
                      <span className="stat-name">{STAT_NAMES[index]}</span>
                      <span className="stat-value" data-testid={`text-stat-value-${key}-${pokemon.id}`}>{value}</span>
                      <div className="stat-track" role="progressbar" aria-label={`${STAT_NAMES[index]} base stat`} aria-valuenow={value} aria-valuemin={0} aria-valuemax={255}>
                        <div className="stat-fill" style={{ width: `${Math.min(value / 255 * 100, 100)}%` }} />
                      </div>
                    </div>;
                  })}
                </div>
              </section>
            </section>

            <aside className="side-stack">
              <section className="panel side-panel">
                <div className="side-heading"><div><div className="eyebrow">Growth path</div><h2>Evolution line</h2></div><span>Tap to explore</span></div>
                {evoLoading ? <div className="skeleton" style={{ height: 110 }} data-testid="status-evolution-loading" /> :
                  evolutions ? <div className="evolution-list" data-testid="list-evolutions">
                    <EvolutionNodeCard entry={evolutions} activeId={pokemon.id} onChoose={(name) => void loadPokemon(name)} />
                  </div> : <div className="empty-favs" data-testid="status-evolution-unavailable">No evolution details are available for this Pokémon.</div>}
              </section>

              <section className="panel compare-panel">
                <div className="side-heading"><div><div className="eyebrow">Make a matchup</div><h2>Compare</h2></div><ArrowLeftRight size={17} color="#928c80" /></div>
                <div className="compare-search">
                  <input aria-label="First Pokémon to compare" placeholder="Name or number" value={compareQueryA} onChange={(event) => setCompareQueryA(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitCompare('a'); } }} data-testid="input-compare-first" />
                  <button onClick={() => void submitCompare('a')} data-testid="button-compare-first">Set</button>
                </div>
                <div className="compare-search">
                  <input aria-label="Second Pokémon to compare" placeholder="Name or number" value={compareQueryB} onChange={(event) => setCompareQueryB(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitCompare('b'); } }} data-testid="input-compare-second" />
                  <button onClick={() => void submitCompare('b')} data-testid="button-compare-second">Set</button>
                </div>
                {compareError && <div className="message error" role="alert" data-testid="status-compare-error">{compareError}</div>}
                {compareReady ? <>
                  <div className="compare-identities">
                    {[compareA, compareB].map((mon, index) => <div className="compare-mon" key={`${index}-${mon!.id}`} data-testid={`card-compare-pokemon-${index + 1}`}>
                      {artwork(mon) && <img src={artwork(mon)} alt={`Official artwork of ${mon.name}`} />}
                      <strong>{mon.name}</strong><span>{dexId(mon.id)}</span>
                    </div>)}
                  </div>
                  <div data-testid="list-comparison-stats">
                    {STAT_KEYS.map((key, index) => {
                      const a = getStat(compareA!, key);
                      const b = getStat(compareB!, key);
                      return <div className="compare-row" key={key} data-testid={`row-compare-${key}`}>
                        <div className={`compare-value left ${a > b ? 'winner' : ''}`} data-testid={`text-compare-first-${key}`}>{a}<div className="compare-bar"><span style={{ width: `${a / 255 * 100}%` }} /></div></div>
                        <div className="compare-label">{STAT_NAMES[index]}</div>
                        <div className={`compare-value right ${b > a ? 'winner' : ''}`} data-testid={`text-compare-second-${key}`}>{b}<div className="compare-bar"><span style={{ width: `${b / 255 * 100}%` }} /></div></div>
                      </div>;
                    })}
                  </div>
                </> : <div className="empty-favs" data-testid="status-compare-empty">Choose two Pokémon to see their stats side by side.</div>}
              </section>

              <section className="panel favourites-panel">
                <div className="side-heading"><div><div className="eyebrow">Your collection</div><h2>Favorites</h2></div><span data-testid="text-favorites-count">{favorites.length} saved</span></div>
                {favoriteMons.length ? <div className="favourite-list" data-testid="list-favorites">
                  {favoriteMons.map((mon) => <div className="favourite-item" key={mon.id} data-testid={`item-favorite-${mon.id}`}>
                    {artwork(mon) && <img src={artwork(mon)} alt="" />}
                    <button className="name" onClick={() => void loadPokemon(mon.name)} data-testid={`button-open-favorite-${mon.id}`}><strong>{mon.name}</strong><small>{dexId(mon.id)} · {mon.types.map(({ type }) => type.name).join(' / ')}</small></button>
                    <button className="remove-fav" aria-label={`Remove ${mon.name} from favorites`} onClick={() => toggleFavorite(mon)} data-testid={`button-delete-favorite-${mon.id}`}><X size={15} /></button>
                  </div>)}
                </div> : <div className="empty-favs" data-testid="status-favorites-empty">Your field notes are waiting. Save a Pokémon and it will live here.</div>}
              </section>
            </aside>
          </div>
        )}
        {!loading && !pokemon && !error && <div className="panel message info" data-testid="status-ready">Search any Pokémon by name or Pokédex number.</div>}
        <footer className="footer-note"><span>DATA FROM POKÉAPI V2</span><span>A FIELD GUIDE, KEPT BY YOU</span></footer>
      </main>
    </div>
  );
}

function Router() {
  return <Switch><Route path="/" component={Home} /><Route component={NotFound} /></Switch>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><RoutedErrorBoundary><Router /></RoutedErrorBoundary></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
