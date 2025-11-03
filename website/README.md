# Tabocalypse Reaper Website

A playful, professionally designed landing page for the Tabocalypse Reaper Firefox extension.

## Features

- Cartoon reaper mascot with playful animations
- Purple theme matching the extension
- Light/dark mode with system preference detection
- Responsive design
- Minimal dependencies (Tailwind CSS + TypeScript)
- Automated deployment to GitHub Pages

## Development

### Setup

```bash
npm install
```

### Development Mode

Run with live reload:

```bash
npm run dev
```

This starts two watch processes:
- Tailwind CSS compilation
- TypeScript compilation

### Build

Build for production:

```bash
npm run build
# or
./build.sh
```

Output will be in `dist/` directory.

## Project Structure

```
website/
├── src/
│   ├── index.html          # Main landing page
│   ├── styles.css          # Tailwind imports + custom styles
│   └── script.ts           # Theme toggle + interactions
├── assets/
│   ├── reaper-logo.svg     # Cute reaper logo (200x200)
│   ├── reaper-hero.svg     # Hero illustration (600x400)
│   └── demo.png            # Extension screenshot
├── dist/                   # Build output (gitignored)
├── tailwind.config.js      # Tailwind configuration
├── tsconfig.json           # TypeScript configuration
├── build.sh                # Build script
└── package.json
```

## Deployment

The website automatically deploys to GitHub Pages when changes are pushed to the `main` branch (via `.github/workflows/deploy-website.yml`).

### Manual Deployment

1. Build the site: `npm run build`
2. The `dist/` folder contains the static site
3. Deploy to any static hosting service

### GitHub Pages Setup

1. Go to repository Settings → Pages
2. Set Source to "GitHub Actions"
3. Push changes to `main` branch
4. GitHub Actions will automatically build and deploy

## Design System

### Colors

- Primary Purple: `#7c3aed` (reaper-700)
- Secondary Purple: `#a855f7` (reaper-500)
- Light Purple: `#a78bfa` (reaper-light)
- Dark Purple: `#5b21b6` (reaper-dark)

### Fonts

- Display: ui-rounded, system fonts
- Body: ui-sans-serif, system fonts

### Animations

- `animate-float` - Floating effect (logo, hero)
- `animate-wiggle` - Wiggle on hover
- `animate-slide-up` - Slide up on reveal
- `animate-fade-in` - Fade in on scroll

## License

MIT
