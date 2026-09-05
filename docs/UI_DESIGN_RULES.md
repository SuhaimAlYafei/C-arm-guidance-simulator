# UI Design Rules

These rules are part of the V3 interface specification. Future UI work should preserve the simulator's instrument-like, clinical engineering character instead of drifting toward generic AI-generated landing-page aesthetics.

## Avoid these patterns

1. Harsh gradients
2. Lucide-icon-heavy interfaces
3. Pure white page backgrounds
4. Rainbow color systems
5. Decorative drop shadows
6. Three generic feature cards in a row
7. Decorative emojis
8. Liquid-glass effects
9. Em dashes in interface copy
10. Inter, Geist, or Space Grotesk as the default UI font
11. Decorative colored left stripes
12. Fake testimonials
13. Bento-grid marketing layouts
14. Fake terminal windows
15. “It’s not X, it’s Y” copywriting
16. Decorative checkmark bullets
17. Generic three-tier pricing layouts
18. Marketing pages without a real product demonstration
19. Excessively soft corner radii
20. Purple-and-black AI styling
21. Missing loading-state placeholders where loading is visible
22. Decorative radial orbs
23. Dot-grid backgrounds
24. Sparkle icons
25. Animated arrows
26. Missing Terms of Use
27. Missing Privacy notice
28. Decorative hover animations
29. Neon colors
30. Generic pastel palettes

## C-Arm simulator visual direction

- Use flat industrial surfaces with restrained neutral grays.
- Use semantic safety colors only when they convey state: warning, collision, route status, or readiness.
- Use 0 to 2 px corner radii for controls and panels.
- Do not use decorative gradients, blur, glass, glow, or drop shadows.
- Use Arial/Helvetica/system sans for interface text and Consolas/Courier only for measurements or technical values.
- Keep controls visually closer to medical equipment software than a startup landing page.
- Prefer borders, spacing, typography, and alignment over decorative cards.
- Keep the actual simulator visible. The product itself is the demonstration.
- Use static skeleton placeholders for visible loading states instead of animated decorative loaders.
- Do not add icons unless the meaning is clearer than text. Never use sparkle icons for AI.
- Keep status colors muted and functional, not decorative.
- Keep motion tied to simulation function. Do not add hover movement, floating elements, or attention-seeking transitions.
- Public releases must expose Privacy and Terms pages.

## Engineering rule

UI refactors must not modify planner geometry, collision logic, route validation, reference-X-ray behavior, GLB loading, or C-arm movement unless the change is explicitly scoped as an engineering change rather than a visual change.
