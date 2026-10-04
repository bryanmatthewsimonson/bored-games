/**
 * User-facing names for Bank. Engine code never imports this file.
 */
export const BANK_THEME = {
  title: 'Bank',
  tagline: 'Roll the pot higher, then bank it before a seven wipes the round.',
  decisions: {
    bank: 'Bank',
    stay: 'Stay',
    roll: 'Roll',
  },
  effects: {
    add: 'added',
    seventy: '70 for the seven',
    double: 'doubled',
    bust: 'busted',
  },
  rounds: { 5: '5 rounds', 10: '10 rounds', 20: '20 rounds' },
  banking: {
    table: 'Everyone may bank',
    turn: 'Only the roller may bank',
  },
} as const;
