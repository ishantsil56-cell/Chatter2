export {};

declare global {
  /** Injected by React Native / Metro. */
  const __DEV__: boolean;

  /** Base64 helpers — present in Hermes, Node and the DOM. Declared so the
   *  crypto/byte utilities type-check regardless of which lib set is loaded. */
  function atob(data: string): string;
  function btoa(data: string): string;
}
