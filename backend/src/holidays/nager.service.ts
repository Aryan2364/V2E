import { BadGatewayException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common'

export interface NagerHoliday {
  date: string
  name: string
  localName: string
  countryCode: string
  global: boolean
  types: string[]
}

export interface NagerCountry {
  countryCode: string
  name: string
}

@Injectable()
export class NagerService {
  private readonly logger = new Logger(NagerService.name)
  private readonly baseUrl = 'https://date.nager.at/api/v3'
  private countriesCache: { data: NagerCountry[]; cachedAt: number } | null = null
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000

  async getAvailableCountries(): Promise<NagerCountry[]> {
    const now = Date.now()
    if (this.countriesCache && now - this.countriesCache.cachedAt < this.CACHE_TTL_MS) {
      return this.countriesCache.data
    }
    try {
      const res = await fetch(`${this.baseUrl}/AvailableCountries`, {
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`Nager.Date returned ${res.status}`)
      const data: NagerCountry[] = await res.json()
      const sorted = data.sort((a, b) => a.name.localeCompare(b.name))
      this.countriesCache = { data: sorted, cachedAt: now }
      return sorted
    } catch (err) {
      this.logger.error(`Failed to fetch available countries from Nager.Date: ${err}`)
      throw new BadGatewayException('Could not fetch available countries. Please try again later.')
    }
  }

  async getPublicHolidays(countryCode: string, year: number): Promise<NagerHoliday[]> {
    try {
      const res = await fetch(`${this.baseUrl}/PublicHolidays/${year}/${countryCode}`, {
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status === 404) throw new NotFoundException(`Country code "${countryCode}" is not supported by Nager.Date`)
      if (!res.ok) throw new BadGatewayException(`Nager.Date returned ${res.status} for ${countryCode}/${year}`)
      return await res.json()
    } catch (err) {
      this.logger.error(`Failed to fetch public holidays for ${countryCode}/${year}: ${err}`)
      if (err instanceof HttpException) throw err
      throw new BadGatewayException(`Could not fetch public holidays for ${countryCode}/${year}`)
    }
  }
}
