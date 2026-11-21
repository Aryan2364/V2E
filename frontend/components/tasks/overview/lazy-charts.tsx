'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The recharts-based overview charts, loaded on demand so routes that do not
 * show them never download recharts. Each card is 320px tall, so the skeleton
 * holds the same space and the layout does not jump when the chart lands.
 */
const chartFallback = () => <Skeleton className="h-[320px] w-full rounded-xl" />

export const StatusTimingChart = dynamic(() => import('./StatusTimingChart'), { ssr: false, loading: chartFallback })
export const PrioritySpreadChart = dynamic(() => import('./PrioritySpreadChart'), { ssr: false, loading: chartFallback })
export const CategorySpreadChart = dynamic(() => import('./CategorySpreadChart'), { ssr: false, loading: chartFallback })
export const MonthlyTrendChart = dynamic(() => import('./MonthlyTrendChart'), { ssr: false, loading: chartFallback })
