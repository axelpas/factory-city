type Child = Node | string | undefined | null | false;

export interface ElProps {
  class?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
  style?: Record<string, string>;
}

function applyProps(node: HTMLElement, props: ElProps): void {
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const [k, v] of Object.entries(props.style ?? {})) node.style.setProperty(k, v);
}

/** Tiny DOM builder: no framework, no innerHTML, so file names can never inject markup. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyProps(node, props);
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}
