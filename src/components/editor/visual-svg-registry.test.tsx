/**
 * Direct contract coverage for the visual SVG registry (issue #1933):
 * `VisualSvgRegistryProvider`, `useRegisterVisualSvg`, and
 * `useVisualSvgRegistry`.
 *
 * Covers: the "no provider" fallback (`useVisualSvgRegistry()` returns
 * `null` outside a provider, and `useRegisterVisualSvg` is a safe no-op),
 * known-id registration/lookup, re-registration when a component re-renders
 * with a new `getSvg` callback (the stable wrapper always calls the latest
 * one), unregistration on unmount, and re-keying when `visualId` changes.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import "@/test/react-render-harness";

import {
  useRegisterVisualSvg,
  useVisualSvgRegistry,
  VisualSvgRegistryProvider,
} from "./visual-svg-registry";

function RegistryReader({
  onRegistry,
}: {
  onRegistry: (
    registry: Map<string, () => SVGSVGElement | null> | null,
  ) => void;
}) {
  const registry = useVisualSvgRegistry();
  onRegistry(registry);
  return null;
}

function VisualCardStub({
  visualId,
  getSvg,
}: {
  visualId: string;
  getSvg: () => SVGSVGElement | null;
}) {
  useRegisterVisualSvg(visualId, getSvg);
  return null;
}

function mount(children: React.ReactNode): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<>{children}</>);
  });
  return renderer;
}

describe("useVisualSvgRegistry / VisualSvgRegistryProvider", () => {
  test("returns null outside a provider, and registration is a safe no-op", () => {
    let observed: unknown = "unset";
    const getSvg = () => null;
    const renderer = mount(
      <>
        <RegistryReader onRegistry={(registry) => (observed = registry)} />
        <VisualCardStub visualId="visual-1" getSvg={getSvg} />
      </>,
    );
    try {
      assert.equal(observed, null);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("registers a visual's getSvg callback under the provider so it can be resolved by id", () => {
    let registry: Map<string, () => SVGSVGElement | null> | null = null;
    const svgEl = {} as SVGSVGElement;
    const renderer = mount(
      <VisualSvgRegistryProvider>
        <RegistryReader onRegistry={(value) => (registry = value)} />
        <VisualCardStub visualId="visual-1" getSvg={() => svgEl} />
      </VisualSvgRegistryProvider>,
    );
    try {
      assert.ok(registry);
      const map: Map<string, () => SVGSVGElement | null> = registry;
      assert.equal(map.size, 1);
      const getter = map.get("visual-1");
      assert.ok(getter);
      assert.equal(getter!(), svgEl);
      // An id with no registered visual resolves to undefined (unknown-id
      // resolution), not a thrown error.
      assert.equal(map.get("does-not-exist"), undefined);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("multiple visuals register under distinct ids simultaneously", () => {
    let registry: Map<string, () => SVGSVGElement | null> | null = null;
    const svgA = {} as SVGSVGElement;
    const svgB = {} as SVGSVGElement;
    const renderer = mount(
      <VisualSvgRegistryProvider>
        <RegistryReader onRegistry={(value) => (registry = value)} />
        <VisualCardStub visualId="visual-a" getSvg={() => svgA} />
        <VisualCardStub visualId="visual-b" getSvg={() => svgB} />
      </VisualSvgRegistryProvider>,
    );
    try {
      assert.equal(registry!.size, 2);
      assert.equal(registry!.get("visual-a")!(), svgA);
      assert.equal(registry!.get("visual-b")!(), svgB);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("always calls the latest getSvg after a re-render, without re-registering the map entry", () => {
    let registry: Map<string, () => SVGSVGElement | null> | null = null;
    const svgOld = {} as SVGSVGElement;
    const svgNew = {} as SVGSVGElement;
    const renderer = mount(
      <VisualSvgRegistryProvider>
        <RegistryReader onRegistry={(value) => (registry = value)} />
        <VisualCardStub visualId="visual-1" getSvg={() => svgOld} />
      </VisualSvgRegistryProvider>,
    );
    try {
      const getterBefore = registry!.get("visual-1");
      assert.equal(getterBefore!(), svgOld);

      act(() => {
        renderer.update(
          <VisualSvgRegistryProvider>
            <RegistryReader onRegistry={(value) => (registry = value)} />
            <VisualCardStub visualId="visual-1" getSvg={() => svgNew} />
          </VisualSvgRegistryProvider>,
        );
      });
      const getterAfter = registry!.get("visual-1");
      // The stable wrapper identity doesn't change...
      assert.equal(getterAfter, getterBefore);
      // ...but invoking it reflects the latest getSvg passed in.
      assert.equal(getterAfter!(), svgNew);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("unregisters on unmount so a stale visual id resolves to undefined", () => {
    let registry: Map<string, () => SVGSVGElement | null> | null = null;
    const renderer = mount(
      <VisualSvgRegistryProvider>
        <RegistryReader onRegistry={(value) => (registry = value)} />
        <VisualCardStub visualId="visual-1" getSvg={() => null} />
      </VisualSvgRegistryProvider>,
    );
    try {
      assert.equal(registry!.size, 1);
      act(() => {
        renderer.update(
          <VisualSvgRegistryProvider>
            <RegistryReader onRegistry={(value) => (registry = value)} />
          </VisualSvgRegistryProvider>,
        );
      });
      assert.equal(registry!.size, 0);
      assert.equal(registry!.get("visual-1"), undefined);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("re-keys the registration when visualId changes: old id is freed, new id resolves", () => {
    let registry: Map<string, () => SVGSVGElement | null> | null = null;
    const svgEl = {} as SVGSVGElement;
    const renderer = mount(
      <VisualSvgRegistryProvider>
        <RegistryReader onRegistry={(value) => (registry = value)} />
        <VisualCardStub visualId="visual-old" getSvg={() => svgEl} />
      </VisualSvgRegistryProvider>,
    );
    try {
      assert.equal(registry!.get("visual-old")!(), svgEl);
      act(() => {
        renderer.update(
          <VisualSvgRegistryProvider>
            <RegistryReader onRegistry={(value) => (registry = value)} />
            <VisualCardStub visualId="visual-new" getSvg={() => svgEl} />
          </VisualSvgRegistryProvider>,
        );
      });
      assert.equal(registry!.get("visual-old"), undefined);
      assert.equal(registry!.get("visual-new")!(), svgEl);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("provider gives each mount its own stable, isolated Map instance", () => {
    let registryA: Map<string, unknown> | null = null;
    let registryB: Map<string, unknown> | null = null;
    const rendererA = mount(
      <VisualSvgRegistryProvider>
        <RegistryReader onRegistry={(value) => (registryA = value)} />
        <VisualCardStub visualId="shared-id" getSvg={() => null} />
      </VisualSvgRegistryProvider>,
    );
    const rendererB = mount(
      <VisualSvgRegistryProvider>
        <RegistryReader onRegistry={(value) => (registryB = value)} />
      </VisualSvgRegistryProvider>,
    );
    try {
      assert.notEqual(registryA, registryB);
      assert.equal(registryA!.size, 1);
      assert.equal(registryB!.size, 0);
    } finally {
      act(() => rendererA.unmount());
      act(() => rendererB.unmount());
    }
  });
});
