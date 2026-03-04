/**
 * Database Module for Markdown Viewer
 * Uses Quick's collection API with localStorage fallback.
 * All document queries are scoped to the current user's email.
 */

const DocumentsDB = {
  COLLECTION: "documents",
  _userEmail: null,

  /**
   * Set the current user email. Must be called before any queries.
   */
  setUser(email) {
    this._userEmail = email;
  },

  getCollection() {
    return quick.db.collection(this.COLLECTION);
  },

  /**
   * Get all documents belonging to the current user
   */
  async getAll() {
    try {
      const collection = this.getCollection();
      const all = (await collection.find()) || [];
      return all.filter((d) => d.ownerEmail === this._userEmail);
    } catch (error) {
      console.error("Error fetching documents:", error);
      return [];
    }
  },

  async getById(id) {
    try {
      const collection = this.getCollection();
      const doc = await collection.findById(id);
      if (!doc || doc.ownerEmail !== this._userEmail) return null;
      return doc;
    } catch (error) {
      console.error("Error fetching document by ID:", error);
      return null;
    }
  },

  async getBySlug(slug) {
    try {
      const docs = await this.getAll();
      return docs.find((d) => d.slug === slug) || null;
    } catch (error) {
      console.error("Error fetching document by slug:", error);
      return null;
    }
  },

  /**
   * Get a document by slug without ownership filtering (for shared links).
   * Any authenticated user can read any document via its slug.
   */
  async getBySlugPublic(slug) {
    try {
      const collection = this.getCollection();
      const all = (await collection.find()) || [];
      return all.find((d) => d.slug === slug) || null;
    } catch (error) {
      console.error("Error fetching shared document:", error);
      return null;
    }
  },

  async create(data) {
    try {
      const slug = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID().replace(/-/g, "").substring(0, 12)
        : Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      const title =
        data.title || this._extractTitle(data.content) || "Untitled";
      const collection = this.getCollection();
      return await collection.create({
        title,
        content: data.content || "",
        slug,
        fileName: data.fileName || null,
        ownerEmail: this._userEmail,
        owner: data.owner || null,
        lastEditedBy: data.owner
          ? {
              email: data.owner.email,
              fullName: data.owner.fullName,
              timestamp: new Date().toISOString(),
            }
          : null,
      });
    } catch (error) {
      console.error("Error creating document:", error);
      return null;
    }
  },

  async update(id, data) {
    try {
      // Verify ownership before updating
      const doc = await this.getById(id);
      if (!doc) return null;

      const collection = this.getCollection();
      return await collection.update(id, {
        ...data,
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error updating document:", error);
      return null;
    }
  },

  async delete(id) {
    try {
      // Verify ownership before deleting
      const doc = await this.getById(id);
      if (!doc) return false;

      const collection = this.getCollection();
      return await collection.delete(id);
    } catch (error) {
      console.error("Error deleting document:", error);
      return false;
    }
  },

  async search(query) {
    try {
      const docs = await this.getAll();
      if (!query || !query.trim()) return docs;

      const terms = query.toLowerCase().trim().split(/\s+/);

      return docs
        .map((doc) => {
          const titleLower = (doc.title || "").toLowerCase();
          const contentLower = (doc.content || "").toLowerCase();
          let score = 0;

          for (const term of terms) {
            if (titleLower.includes(term)) score += 10;
            if (contentLower.includes(term)) score += 1;
            if (titleLower === query.toLowerCase().trim()) score += 50;
            if (titleLower.startsWith(term)) score += 5;
          }

          return { doc, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.doc);
    } catch (error) {
      console.error("Error searching documents:", error);
      return [];
    }
  },

  async getByFileName(fileName) {
    try {
      const docs = await this.getAll();
      return docs.find((d) => d.fileName === fileName) || null;
    } catch (error) {
      console.error("Error fetching document by filename:", error);
      return null;
    }
  },

  _extractTitle(content) {
    if (!content) return null;
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  },
};

const CommentsDB = {
  COLLECTION: "comments",

  getCollection() {
    return quick.db.collection(this.COLLECTION);
  },

  async getByDocumentId(docId) {
    try {
      const all = await this.getCollection().find();
      return (all || []).filter((c) => c.documentId === docId);
    } catch (error) {
      console.error("Error fetching comments:", error);
      return [];
    }
  },

  async create(data) {
    try {
      return await this.getCollection().create(data);
    } catch (error) {
      console.error("Error creating comment:", error);
      return null;
    }
  },

  async resolve(id, resolvedBy) {
    try {
      return await this.getCollection().update(id, {
        resolved: true,
        resolvedBy,
      });
    } catch (error) {
      console.error("Error resolving comment:", error);
      return null;
    }
  },

  async delete(id) {
    try {
      return await this.getCollection().delete(id);
    } catch (error) {
      console.error("Error deleting comment:", error);
      return false;
    }
  },
};
