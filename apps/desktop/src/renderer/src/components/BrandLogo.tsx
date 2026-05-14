import type { JSX } from "react";
import mauzLogo from "@renderer/assets/mauzai-logo.png";

type BrandLogoProps = {
  className?: string;
  label?: string;
};

export function BrandLogo({ className, label }: BrandLogoProps): JSX.Element {
  const classes = ["brand-logo", className].filter(Boolean).join(" ");

  return (
    <img
      className={classes}
      src={mauzLogo}
      alt={label ?? ""}
      aria-hidden={label === undefined ? "true" : undefined}
      draggable={false}
    />
  );
}
