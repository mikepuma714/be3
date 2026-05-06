/* ============================================================
   CENTURY 21 BE3 — Main JavaScript
   Parallax · Counters · Nav · Animations · FAQ · Calculator
   ============================================================ */

'use strict';

/* ========================= NAV ========================= */
const nav = document.getElementById('nav');
const hamburger = document.getElementById('hamburger');
const navDrawer = document.getElementById('navDrawer');

// Scroll-based nav background
let lastScroll = 0;
const SCROLL_THRESHOLD = 60;

function handleNavScroll() {
  const scrollY = window.scrollY;
  if (scrollY > SCROLL_THRESHOLD) {
    nav.classList.add('scrolled');
  } else {
    nav.classList.remove('scrolled');
  }
  lastScroll = scrollY;
}

window.addEventListener('scroll', handleNavScroll, { passive: true });
handleNavScroll(); // run on init

// Mobile menu toggle
if (hamburger && navDrawer) {
  hamburger.addEventListener('click', () => {
    const isOpen = navDrawer.classList.toggle('open');
    hamburger.classList.toggle('open', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  // Close drawer when a link is clicked
  navDrawer.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navDrawer.classList.remove('open');
      hamburger.classList.remove('open');
      document.body.style.overflow = '';
    });
  });
}

// Highlight active nav link
(function setActiveNav() {
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .nav-drawer a').forEach(link => {
    const href = link.getAttribute('href');
    if (href && (href === currentPage || (currentPage === '' && href === 'index.html'))) {
      link.classList.add('active');
    }
  });
})();

/* ========================= PARALLAX ========================= */
let rafPending = false;

function updateParallax() {
  const scrollY = window.scrollY;
  const vh = window.innerHeight;

  // Hero backgrounds
  document.querySelectorAll('[data-parallax]').forEach(el => {
    const section = el.closest('[data-parallax-section]') || el.parentElement;
    const rect = section.getBoundingClientRect();

    // Only update elements near viewport
    if (rect.bottom < -200 || rect.top > vh + 200) return;

    const speed = parseFloat(el.dataset.parallax) || 0.3;
    const center = rect.top + rect.height / 2 - vh / 2;
    const offset = center * speed;
    el.style.transform = `translate3d(0, ${offset}px, 0)`;
  });

  rafPending = false;
}

function onScroll() {
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(updateParallax);
  }
}

window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', updateParallax, { passive: true });
updateParallax();

/* ========================= REVEAL ON SCROLL ========================= */
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
);

document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(el => {
  revealObserver.observe(el);
});

/* ========================= COUNTER ANIMATION ========================= */
function animateCounter(el) {
  const target = parseFloat(el.dataset.target);
  const prefix = el.dataset.prefix || '';
  const suffix = el.dataset.suffix || '';
  const decimals = el.dataset.decimals ? parseInt(el.dataset.decimals) : 0;
  const duration = 2000;
  const start = performance.now();

  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const value = target * easeOutQuart(progress);
    el.textContent = prefix + value.toFixed(decimals) + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

const counterObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        counterObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.5 }
);

document.querySelectorAll('[data-counter]').forEach(el => {
  counterObserver.observe(el);
});

/* ========================= FAQ ========================= */
document.querySelectorAll('.faq-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.closest('.faq-item');
    const isOpen = item.classList.contains('open');

    // Close all
    document.querySelectorAll('.faq-item.open').forEach(openItem => {
      openItem.classList.remove('open');
    });

    // Open clicked (unless it was already open)
    if (!isOpen) item.classList.add('open');
  });
});

// Open first FAQ by default
const firstFaq = document.querySelector('.faq-item');
if (firstFaq) firstFaq.classList.add('open');

/* ========================= INCOME CALCULATOR ========================= */
const calcForm = document.getElementById('calcForm');
if (calcForm) {
  const inputs = calcForm.querySelectorAll('input[type="range"], input[type="number"], select');
  const resultBe3 = document.getElementById('calcResultBe3');
  const resultTypical = document.getElementById('calcResultTypical');
  const resultDiff = document.getElementById('calcResultDiff');
  const dealsDisplay = document.getElementById('dealsDisplay');
  const priceDisplay = document.getElementById('priceDisplay');

  function formatCurrency(n) {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
    return '$' + Math.round(n).toLocaleString();
  }

  function recalculate() {
    const deals = parseFloat(document.getElementById('calcDeals')?.value) || 1;
    const price = parseFloat(document.getElementById('calcPrice')?.value) || 350000;
    const commPct = parseFloat(document.getElementById('calcComm')?.value) || 3;

    if (dealsDisplay) dealsDisplay.textContent = deals;
    if (priceDisplay) priceDisplay.textContent = '$' + price.toLocaleString();

    const grossComm = price * (commPct / 100);
    const annualGross = grossComm * deals * 12;

    const be3Annual = annualGross * 0.90;
    const typicalAnnual = annualGross * 0.70;
    const diff = be3Annual - typicalAnnual;

    if (resultBe3) resultBe3.textContent = formatCurrency(be3Annual);
    if (resultTypical) resultTypical.textContent = formatCurrency(typicalAnnual);
    if (resultDiff) resultDiff.textContent = '+' + formatCurrency(diff) + '/yr with BE3';
  }

  inputs.forEach(input => input.addEventListener('input', recalculate));
  recalculate();
}

/* ========================= SMOOTH ANCHOR SCROLL ========================= */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const navHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height'));
      const top = target.getBoundingClientRect().top + window.scrollY - navHeight - 20;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});

/* ========================= VALUE TICKER DUPLICATE ========================= */
// Duplicate ticker items so the scroll loop is seamless
const ticker = document.querySelector('.value-band-track');
if (ticker) {
  ticker.innerHTML += ticker.innerHTML;
}

/* ========================= CURSOR GLOW (subtle luxury feel) ========================= */
const glow = document.createElement('div');
glow.style.cssText = `
  position: fixed; pointer-events: none; z-index: 9999;
  width: 300px; height: 300px;
  background: radial-gradient(circle, rgba(201,166,60,0.06) 0%, transparent 70%);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  transition: opacity 0.3s;
  opacity: 0;
`;
document.body.appendChild(glow);

let glowVisible = false;
document.addEventListener('mousemove', e => {
  glow.style.left = e.clientX + 'px';
  glow.style.top = e.clientY + 'px';
  if (!glowVisible) {
    glow.style.opacity = '1';
    glowVisible = true;
  }
}, { passive: true });

document.addEventListener('mouseleave', () => {
  glow.style.opacity = '0';
  glowVisible = false;
});
