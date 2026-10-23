"use client";

import dynamic from "next/dynamic";
import { createContext, useContext } from "react";
import Badge from "./Badge";
import type { Badge3DProps } from "./Badge3D";

export type { Badge3DProps };

// next/dynamic's loading fallback receives no component props, so pass them
// through context: the fallback renders the CSS badge with identical props.
const PropsCtx = createContext<Badge3DProps | null>(null);

function Fallback() {
  const p = useContext(PropsCtx);
  return p ? <Badge {...p} /> : null;
}

const Lazy3D = dynamic(() => import("./Badge3D"), {
  ssr: false,
  loading: () => <Fallback />,
});

export default function Badge3DLazy(props: Badge3DProps) {
  return (
    <PropsCtx.Provider value={props}>
      <Lazy3D {...props} />
    </PropsCtx.Provider>
  );
}
