export function consumeBootstrapToken(
  parameter: string,
  storageKey: string,
  location: Pick<Location, "href"> = window.location,
  history: Pick<History, "replaceState"> = window.history,
  storage: Pick<Storage, "getItem" | "setItem"> = window.sessionStorage,
): string {
  const url = new URL(location.href);
  const incoming = url.searchParams.get(parameter);
  if (incoming) {
    storage.setItem(storageKey, incoming);
    url.searchParams.delete(parameter);
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    return incoming;
  }
  return storage.getItem(storageKey) ?? "";
}
