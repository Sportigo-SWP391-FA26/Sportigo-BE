import { z } from 'zod'

const optionalUrl = z.string().url().optional().nullable()

export const heroSlideSchema = z.object({
  title: z.string().trim().min(2).max(160),
  subtitle: z.string().trim().max(500).optional().nullable(),
  imageUrl: z.string().url(),
  sportId: z.number().int().positive().optional().nullable(),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
})

export const facilitySchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(800).optional().nullable(),
  imageUrl: z.string().url(),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
})

export const partnerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  logoUrl: z.string().url(),
  websiteUrl: optionalUrl,
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
})

export const siteSettingSchema = z.object({
  hotline: z.string().trim().min(3).max(40),
  openingHours: z.string().trim().min(3).max(120),
  location: z.string().trim().min(2).max(160),
  brandDescription: z.string().trim().min(10).max(1200),
  authPromotionTitle: z.string().trim().max(200).optional().nullable(),
  authPromotionDescription: z.string().trim().max(800).optional().nullable(),
})

export const newsletterSchema = z.object({ email: z.string().trim().toLowerCase().email().max(255) })

export const contentKindSchema = z.enum(['heroes', 'facilities', 'partners'])
