export function requireElement<T extends Element>(
  selector: string,
  root: Document | Element = document
): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element for selector: ${selector}`);
  }
  return element;
}

export function requireDescendant<T extends Element>(
  root: DocumentFragment | Document | Element,
  selector: string
): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing descendant for selector: ${selector}`);
  }
  return element;
}
