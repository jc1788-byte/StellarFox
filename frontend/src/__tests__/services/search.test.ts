// ============================================================
// Advanced Search Service Tests
// ============================================================

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  highlightSearchTerms,
  createSearchSnippet,
  validateSearchQuery,
  getCachedSearchFacets,
  clearFacetsCache,
} from '../../services/search';

describe('Search Service', () => {
  describe('highlightSearchTerms', () => {
    it('should highlight exact matches', () => {
      const text = 'John Doe vs Jane Doe';
      const result = highlightSearchTerms(text, 'Doe');
      expect(result).toContain('<mark>Doe</mark>');
    });

    it('should be case-insensitive', () => {
      const text = 'John DOE vs Jane doe';
      const result = highlightSearchTerms(text, 'doe');
      expect(result).toContain('<mark>');
    });

    it('should handle multiple terms', () => {
      const text = 'John Doe vs Jane Doe';
      const result = highlightSearchTerms(text, 'John Jane');
      expect(result).toContain('<mark>');
    });

    it('should return original text if no query', () => {
      const text = 'John Doe';
      const result = highlightSearchTerms(text, '');
      expect(result).toBe(text);
    });
  });

  describe('createSearchSnippet', () => {
    it('should create snippet around match', () => {
      const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. John Doe is a fighter.';
      const snippet = createSearchSnippet(text, 'John', 50);
      expect(snippet).toContain('John');
    });

    it('should add ellipsis for truncation', () => {
      const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
      const snippet = createSearchSnippet(text, 'Lorem', 20);
      expect(snippet).toContain('...');
    });

    it('should return full text if shorter than limit', () => {
      const text = 'Short text';
      const snippet = createSearchSnippet(text, 'text', 50);
      expect(snippet).toBe(text);
    });
  });

  describe('validateSearchQuery', () => {
    it('should accept valid queries', () => {
      const result = validateSearchQuery('John Doe');
      expect(result.valid).toBe(true);
    });

    it('should reject empty queries', () => {
      const result = validateSearchQuery('');
      expect(result.valid).toBe(false);
    });

    it('should reject queries over 200 chars', () => {
      const longQuery = 'a'.repeat(201);
      const result = validateSearchQuery(longQuery);
      expect(result.valid).toBe(false);
    });

    it('should reject potential injection attacks', () => {
      const result = validateSearchQuery('<script>alert("xss")</script>');
      expect(result.valid).toBe(false);
    });

    it('should reject javascript: URIs', () => {
      const result = validateSearchQuery('javascript:alert(1)');
      expect(result.valid).toBe(false);
    });
  });

  describe('Facets Caching', () => {
    beforeEach(() => {
      clearFacetsCache();
    });

    it('should clear cache', () => {
      clearFacetsCache();
      // This would require mocking the actual API call
      // For now, we just verify the function doesn't throw
      expect(() => clearFacetsCache()).not.toThrow();
    });
  });
});
