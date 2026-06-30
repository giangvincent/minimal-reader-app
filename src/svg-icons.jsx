// src/svg-icons.js
import React from 'react';

export const ChevronLeftIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M15.5 4.088c-1.104 0-2 .896-2 2V18c0 1.104.896 2 2 2s2-.896 2-2V6.088c0-1.104-.896-2-2-2z" fill="currentColor"/>
    <path d="M5.5 12L15.5 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const ChevronRightIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M8.5 4.088c1.104 0 2 .896 2 2V18c0 1.104-.896 2-2 2s-2-.896-2-2V6.088c0-1.104.896-2 2-2z" fill="currentColor"/>
    <path d="M18.5 12L8.5 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const PlusIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M12 4V20M4 12H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const TrashIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M3 6h18M19 6V4c0-1.104-.896-2-2-2H7C5.896 2 5 2.896 5 4v2M10 11V7m4 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const SearchIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2"/>
    <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2"/>
  </svg>
);

export const MoonIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M12 19.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM2.25 12C2.25 6.613 6.613 2.25 12 2.25s9.75 4.363 9.75 9.75-4.363 9.75-9.75 9.75S2.25 17.387 2.25 12z" fill="currentColor"/>
  </svg>
);

export const SunIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M12 3v2M12 19v2M19 12h2M5 12H3M6.228 6.228l-1.414 1.414M17.657 17.657l-1.414 1.414M17.657 6.343l-1.414-1.414m0 11.314l-1.414 1.414M6.343 17.657l-1.414 1.414" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);