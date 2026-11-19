import { kstDay } from './time';

/**
 * The Briefing's painting of the day. All public domain, downloaded once
 * from Wikimedia Commons into /public/paintings (1100 px wide).
 */
export type Painting = {
  slug: string;
  title: string;
  artist: string;
  year: string;
  medium: string;
  /** CSS object-position, so the interesting part stays in the 4:3 frame. */
  focus?: string;
};

export const PAINTINGS: Painting[] = [
  { slug: 'ssireum', title: 'Ssireum (씨름)', artist: 'Kim Hong-do (김홍도)', year: 'late 18th century', medium: 'ink and light colour on paper', focus: '50% 55%' },
  { slug: 'great-wave', title: 'The Great Wave off Kanagawa', artist: 'Katsushika Hokusai', year: 'c. 1831', medium: 'woodblock print' },
  { slug: 'impression-sunrise', title: 'Impression, Sunrise', artist: 'Claude Monet', year: '1872', medium: 'oil on canvas' },
  { slug: 'starry-night', title: 'The Starry Night', artist: 'Vincent van Gogh', year: '1889', medium: 'oil on canvas' },
  { slug: 'milkmaid', title: 'The Milkmaid', artist: 'Johannes Vermeer', year: 'c. 1658', medium: 'oil on canvas', focus: '50% 40%' },
  { slug: 'paris-street-rainy-day', title: 'Paris Street; Rainy Day', artist: 'Gustave Caillebotte', year: '1877', medium: 'oil on canvas' },
  { slug: 'grande-jatte', title: 'A Sunday Afternoon on the Island of La Grande Jatte', artist: 'Georges Seurat', year: '1884–1886', medium: 'oil on canvas' },
  { slug: 'wanderer', title: 'Wanderer above the Sea of Fog', artist: 'Caspar David Friedrich', year: 'c. 1818', medium: 'oil on canvas', focus: '50% 35%' },
  { slug: 'boating-party', title: 'Luncheon of the Boating Party', artist: 'Pierre-Auguste Renoir', year: '1880–1881', medium: 'oil on canvas' },
  { slug: 'cafe-terrace', title: 'Café Terrace at Night', artist: 'Vincent van Gogh', year: '1888', medium: 'oil on canvas', focus: '50% 45%' },
];

/** Same painting all day (Korea time), a different one the next day. */
export function paintingOfTheDay(now: number): Painting {
  const day = Math.floor(Date.parse(`${kstDay(now)}T00:00:00+09:00`) / 86_400_000);
  return PAINTINGS[((day % PAINTINGS.length) + PAINTINGS.length) % PAINTINGS.length];
}

export const paintingCaption = (p: Painting) => `${p.title}, ${p.artist}, ${p.year}. ${p.medium[0].toUpperCase()}${p.medium.slice(1)}.`;
