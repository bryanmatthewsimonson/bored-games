import type { BrandNames } from '@bored-games/game-kit';
import type { Kind } from './cards.ts';
export const GILT_AND_GUILE_BRAND: BrandNames = {
  id: 'safe',
  gameTitle: 'Gilt & Guile',
  tagline: 'A little money. A little mischief. A standing ovation.',
  summary:
    'Build a theatre company from pocket change and ambition. Recruit a remarkable cast, outwit rival producers, and turn tonight’s takings into lasting acclaim. A competitive deck-building game with 26 company cards and a different ten-pile supply at every table.',
  aliases: ['theatre', 'theater', 'deck building', 'art deco'],
};
export const GILT_AND_GUILE_THEME = {
  title: GILT_AND_GUILE_BRAND.gameTitle,
  tagline: GILT_AND_GUILE_BRAND.tagline,
};
export const CARD_NAMES: Record<Kind, string> = {
  penny: 'Penny',
  banknote: 'Banknote',
  endowment: 'Endowment',
  playbill: 'Playbill',
  playhouse: 'Playhouse',
  grandstage: 'Grand Stage',
  scandal: 'Scandal',
  rehearsal: 'Rehearsal',
  arcade: 'Arcade',
  impresario: 'Impresario',
  rivalry: 'Rivalry',
  investor: 'Investor',
  understudy: 'Understudy',
  renovation: 'Renovation',
  scriptroom: 'Script Room',
  ensemble: 'Ensemble',
  propmaker: 'Propmaker',
  costumier: 'Costumier',
  headliner: 'Headliner',
  booking: 'Booking Office',
  cuttingroom: 'Cutting Room',
  openingnight: 'Opening Night',
  gala: 'Gala',
  repertoire: 'Repertoire',
  encore: 'Encore',
  duet: 'Duet',
  readingroom: 'Reading Room',
  cashbox: 'Cashbox',
  audition: 'Audition',
  stagedoor: 'Stage Door',
  doublebill: 'Double Bill',
  busker: 'Busker',
  critic: 'Critic',
};
export const CARD_TEXT: Record<Kind, string> = {
  penny: 'Provides 1 coin when played.',
  banknote: 'Provides 2 coins when played.',
  endowment: 'Provides 3 coins when played.',
  playbill: 'Worth 1 acclaim at the end.',
  playhouse: 'Worth 3 acclaim at the end.',
  grandstage: 'Worth 6 acclaim at the end.',
  scandal: 'Lose 1 acclaim at the end.',
  rehearsal: '+1 action. Discard any number of cards, then draw that many.',
  arcade: 'Draw 1. +1 action, +1 buy, +1 coin.',
  impresario: 'Draw 1. +1 action. The first Banknote you play this turn provides an extra coin.',
  rivalry: '+2 coins. Each opponent discards down to 3 cards.',
  investor:
    'You may trash a treasure from your hand. If you do, gain a treasure costing up to 3 more into your hand.',
  understudy:
    'Draw 2. You may reveal this from your hand to ignore an attack on you. Keep this card in your hand.',
  renovation: 'Trash a card from your hand, then gain a card costing up to 2 more.',
  scriptroom: 'Draw 3 cards.',
  ensemble: 'Draw 1. +2 actions.',
  propmaker: 'Gain a card costing up to 4.',
  costumier:
    'Gain a card costing up to 5 into your hand. Then put a card from your hand on top of your deck.',
  headliner:
    'Gain an Endowment. Each opponent reveals their top 2 cards, trashes one revealed treasure other than a Penny if possible, and discards the rest.',
  booking:
    'Gain a Banknote onto your deck. Each opponent puts a victory card from their hand onto their deck, showing it. Anyone without one reveals their hand.',
  cuttingroom: 'Trash up to 4 cards from your hand.',
  openingnight: 'Draw 4. +1 buy. Each opponent draws 1 card.',
  gala: '+2 actions. +1 buy. +2 coins.',
  repertoire: 'Worth 1 acclaim for every complete 10 cards you own. Count all zones at the end.',
  encore: 'Draw 1. +1 action. You may put a card from your discard pile onto your deck.',
  duet: 'Draw 2. +1 action.',
  readingroom:
    'Draw until you have 7 cards in hand. You may set aside action cards as you draw them; discard those set aside after you finish.',
  cashbox: 'You may trash a Penny from your hand. If you do, +3 coins.',
  audition: 'Draw 1. +1 action. +1 coin. Discard one card per empty supply pile.',
  stagedoor:
    'Draw 1. +1 action. Look at the top 2 cards of your deck. Trash any, then discard any, then return the rest in your chosen order.',
  doublebill:
    'You may play an action card from your hand twice. Fully finish its first play before its second.',
  busker: '+2 coins. Discard the top card of your deck. If it is an action, you may play it.',
  critic: 'Draw 2. Each opponent gains a Scandal.',
};
export const ATTACKS: readonly Kind[] = ['rivalry', 'headliner', 'booking', 'critic'];
