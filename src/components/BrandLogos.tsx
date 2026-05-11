// Official Microsoft + Azure brand marks. Both use canonical SVG paths
// from Microsoft's published brand kit so the in-app logos match what
// users see on microsoft.com / portal.azure.com — important on screens
// (datasource picker, admin consent) where users have to recognise the
// provider before authorising. Single source of truth so we don't drift
// across components.
//
// Sizing: pass `size` (px). Both logos render as a square `size × size`
// with `currentColor` ignored — internal fills are baked in.

interface LogoProps {
  size?: number;
  className?: string;
}

// Microsoft brand mark — four-tile logo. Used for Microsoft 365 across
// the Microsoft brand surface (the company doesn't use a separate "365"
// glyph for product UIs; the four tiles are it).
//   Top-left  #F25022 (orange-red)
//   Top-right #7FBA00 (green)
//   Btm-left  #00A4EF (blue)
//   Btm-right #FFB900 (yellow)
// Brand-spec gap between tiles is ~5% of tile size — the 1px gap inside
// a 21×21 viewBox lands exactly there.
export function MicrosoftLogo({ size = 24, className }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 21 21"
      width={size}
      height={size}
      className={className}
      aria-label="Microsoft"
      role="img"
    >
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

// Microsoft Azure brand mark — angular blue "A" formed by two trapezoids
// with depth-shading gradients. Path data is the published Azure logo;
// don't simplify the four-path structure or the depth shading collapses
// into a flat triangle (which is what we had before).
export function AzureLogo({ size = 24, className }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 96 96"
      width={size}
      height={size}
      className={className}
      aria-label="Microsoft Azure"
      role="img"
    >
      <defs>
        <linearGradient
          id="tm-azure-a"
          x1="60.919"
          y1="9.512"
          x2="18.667"
          y2="84.561"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#114A8B" />
          <stop offset="1" stopColor="#0669BC" />
        </linearGradient>
        <linearGradient
          id="tm-azure-b"
          x1="74.117"
          y1="51.726"
          x2="64.345"
          y2="55.029"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopOpacity="0.3" />
          <stop offset="0.07" stopOpacity="0.2" />
          <stop offset="0.32" stopOpacity="0.1" />
          <stop offset="0.62" stopOpacity="0.05" />
          <stop offset="1" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id="tm-azure-c"
          x1="35.001"
          y1="6.825"
          x2="81.371"
          y2="80.881"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#3CCBF4" />
          <stop offset="1" stopColor="#2892DF" />
        </linearGradient>
      </defs>
      <path
        d="M33.338 6.544h26.038l-27.03 80.087a4.151 4.151 0 0 1-3.933 2.824H8.149a4.145 4.145 0 0 1-3.928-5.47L29.404 9.368a4.151 4.151 0 0 1 3.934-2.825z"
        fill="url(#tm-azure-a)"
      />
      <path
        d="M71.175 60.261h-41.29a1.911 1.911 0 0 0-1.305 3.309l26.532 24.764a4.171 4.171 0 0 0 2.846 1.121h23.38z"
        fill="#0078D4"
      />
      <path
        d="M33.338 6.544a4.116 4.116 0 0 0-3.943 2.879L4.252 83.917a4.14 4.14 0 0 0 3.908 5.538h20.787a4.443 4.443 0 0 0 3.41-2.9l5.014-14.777 17.91 16.705a4.237 4.237 0 0 0 2.666.972h23.293L71.024 60.261H50.04L62.876 22.34z"
        fill="url(#tm-azure-b)"
      />
      <path
        d="M66.595 9.364a4.145 4.145 0 0 0-3.928-2.82h-29.02a4.146 4.146 0 0 1 3.929 2.82l25.183 74.62a4.146 4.146 0 0 1-3.928 5.471h29.02a4.146 4.146 0 0 0 3.928-5.47z"
        fill="url(#tm-azure-c)"
      />
    </svg>
  );
}
