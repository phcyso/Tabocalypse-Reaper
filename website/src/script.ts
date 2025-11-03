// Theme management
const THEME_KEY = 'theme';

type Theme = 'light' | 'dark';

function getStoredTheme(): Theme | null {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  return null;
}

function getPreferredTheme(): Theme {
  const stored = getStoredTheme();
  if (stored) {
    return stored;
  }

  // Check system preference
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return 'light';
}

function setTheme(theme: Theme): void {
  const html = document.documentElement;

  if (theme === 'dark') {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }

  localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme(): void {
  const current = getStoredTheme() || getPreferredTheme();
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
}

// Initialize theme on page load
function initTheme(): void {
  const theme = getPreferredTheme();
  setTheme(theme);

  // Remove no-transition class after initial render
  setTimeout(() => {
    document.body.classList.remove('no-transition');
  }, 100);
}

// Smooth scroll with offset for fixed nav
function smoothScrollTo(target: string): void {
  const element = document.querySelector(target);
  if (!element) return;

  const navHeight = 80; // Approximate nav height
  const targetPosition = element.getBoundingClientRect().top + window.pageYOffset - navHeight;

  window.scrollTo({
    top: targetPosition,
    behavior: 'smooth',
  });
}

// Add intersection observer for fade-in animations
function initScrollAnimations(): void {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -100px 0px',
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-fade-in');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Observe all feature cards and sections
  const animatedElements = document.querySelectorAll('.feature-card, section > div');
  animatedElements.forEach((el) => observer.observe(el));
}

// Handle navigation link clicks
function initNavigation(): void {
  const navLinks = document.querySelectorAll('a[href^="#"]');

  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href && href.startsWith('#') && href.length > 1) {
        e.preventDefault();
        smoothScrollTo(href);

        // Update URL without scrolling
        history.pushState(null, '', href);
      }
    });
  });
}

// Add playful micro-interactions
function initMicroInteractions(): void {
  // Wiggle effect on logo hover
  const logo = document.querySelector('nav img');
  if (logo) {
    logo.addEventListener('mouseenter', () => {
      logo.classList.add('animate-wiggle');
    });
    logo.addEventListener('mouseleave', () => {
      logo.classList.remove('animate-wiggle');
    });
  }

  // Add ripple effect to buttons (optional enhancement)
  const buttons = document.querySelectorAll('a[href="#install"], .btn-reaper');
  buttons.forEach((button) => {
    button.addEventListener('click', (e) => {
      const rect = button.getBoundingClientRect();
      const x = (e as MouseEvent).clientX - rect.left;
      const y = (e as MouseEvent).clientY - rect.top;

      const ripple = document.createElement('span');
      ripple.style.cssText = `
        position: absolute;
        width: 20px;
        height: 20px;
        background: rgba(255, 255, 255, 0.6);
        border-radius: 50%;
        pointer-events: none;
        transform: translate(-50%, -50%) scale(0);
        animation: ripple 0.6s ease-out;
        left: ${x}px;
        top: ${y}px;
      `;

      if (button instanceof HTMLElement && button.style.position !== 'relative') {
        button.style.position = 'relative';
        button.style.overflow = 'hidden';
      }

      button.appendChild(ripple);

      setTimeout(() => {
        ripple.remove();
      }, 600);
    });
  });
}

// Add ripple animation to CSS
function addRippleAnimation(): void {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ripple {
      to {
        transform: translate(-50%, -50%) scale(15);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}

// Listen for system theme changes
function watchSystemTheme(): void {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  mediaQuery.addEventListener('change', (e) => {
    // Only update if user hasn't manually set a theme
    if (!getStoredTheme()) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });
}

// Initialize everything when DOM is ready
function init(): void {
  initTheme();
  initNavigation();
  initScrollAnimations();
  initMicroInteractions();
  addRippleAnimation();
  watchSystemTheme();

  // Theme toggle button
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Handle initial hash in URL
  if (window.location.hash) {
    setTimeout(() => {
      smoothScrollTo(window.location.hash);
    }, 100);
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Prevent transition flash on page load
document.body.classList.add('no-transition');
