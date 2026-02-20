declare module "nspell" {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): NSpell;
    remove(word: string): NSpell;
    wordCharacters(): string | undefined;
    dictionary(aff: Buffer | string, dic?: Buffer | string): NSpell;
    personal(dic: Buffer | string): NSpell;
  }
  function nspell(aff: Buffer | string, dic?: Buffer | string): NSpell;
  function nspell(dict: { aff: Buffer | string; dic: Buffer | string }): NSpell;
  export = nspell;
}

declare module "dictionary-en" {
  const dict: { aff: Buffer; dic: Buffer };
  export default dict;
}
