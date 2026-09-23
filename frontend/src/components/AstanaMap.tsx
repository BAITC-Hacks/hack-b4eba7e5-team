import { useEffect, useRef, useState } from 'react'
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import type { FilterSpecification, GeoJSONSource, LayerSpecification, Map as MapInstance, Marker, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { getMapLayer, type District, type MapLayerId } from '../lib/api'
import districtJson from '../data/districts.json'
import basemapJson from '../data/basemap.json'

type MapDistrict = {
  id: string; name: string; case_district: boolean; osm_id: number
  label_point: [number, number]; bounds: [number, number, number, number]
}
const districtsGeo = districtJson as FeatureCollection<Polygon | MultiPolygon, MapDistrict>
const cityBounds: [number, number, number, number] = [71.217973, 50.857608, 71.785191, 51.35111]
const sourceId = 'case-districts'
const noSelection: FilterSpecification = ['==', ['get', 'id'], '']
const overlayNames: { id: MapLayerId; name: string }[] = [
  { id: 'transport_stops', name: 'Остановки' },
  { id: 'green_spaces', name: 'Зелёные зоны' },
  { id: 'schools_kindergartens', name: 'Школы и детсады' },
  { id: 'healthcare', name: 'Медучреждения' },
  { id: 'road_safety_objects', name: 'Переходы и освещение' },
]
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function districtLayers(selected: string): LayerSpecification[] {
  return [
    { id: 'case-fill', type: 'fill', source: sourceId, paint: { 'fill-color': '#64748b', 'fill-opacity': 0.035 } },
    { id: 'case-border', type: 'line', source: sourceId, paint: { 'line-color': '#64748b', 'line-width': 1.2, 'line-opacity': 0.45 } },
    // Фильтр заменяет выбор сразу: старый район не остаётся подсвеченным во время анимации камеры.
    { id: 'case-selected', type: 'fill', source: sourceId, filter: ['==', ['get', 'id'], selected], paint: { 'fill-color': '#0d9488', 'fill-opacity': 0.21 } },
    { id: 'case-selected-border', type: 'line', source: sourceId, filter: ['==', ['get', 'id'], selected], paint: { 'line-color': '#0f766e', 'line-width': 2.5 } },
    { id: 'case-hover', type: 'line', source: sourceId, filter: noSelection, paint: { 'line-color': '#475569', 'line-width': 1.8, 'line-opacity': 0.6 } },
  ]
}

function selection(map: MapInstance, id: string) {
  for (const layer of ['case-selected', 'case-selected-border']) {
    if (map.getLayer(layer)) map.setFilter(layer, ['==', ['get', 'id'], id])
  }
  if (map.getLayer('case-hover')) map.setFilter('case-hover', ['==', ['get', 'id'], ''])
}

function labelClass(selected: boolean, enabled: boolean) {
  return `pointer-events-none rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm transition-colors duration-200 motion-reduce:transition-none ${selected ? 'bg-teal-800 text-white' : enabled ? 'bg-white/90 text-slate-600' : 'bg-white/70 text-slate-400'}`
}

export default function AstanaMap({ districtId, onDistrictChange, districts }: {
  districtId: string; onDistrictChange: (id: string) => void; districts: District[]
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapInstance | null>(null)
  const labels = useRef<{ id: string; enabled: boolean; marker: Marker; text: HTMLDivElement }[]>([])
  const selectedRef = useRef(districtId)
  const pendingFocus = useRef<string | null>(null)
  const onChangeRef = useRef(onDistrictChange)
  const [ready, setReady] = useState(false)
  const [mapError, setMapError] = useState(false)
  const [tilesError, setTilesError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [layer, setLayer] = useState<MapLayerId | ''>('')
  const [layerStatus, setLayerStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const cache = useRef(new Map<MapLayerId, FeatureCollection>())

  useEffect(() => { onChangeRef.current = onDistrictChange }, [onDistrictChange])

  useEffect(() => {
    const changed = selectedRef.current !== districtId
    selectedRef.current = districtId
    if (changed) pendingFocus.current = districtId
    const map = mapRef.current
    if (!map || !ready) return
    selection(map, districtId)
    for (const label of labels.current) label.text.className = labelClass(label.id === districtId, label.enabled)
    if (pendingFocus.current === districtId) {
      const feature = districtsGeo.features.find((f) => f.properties.id === districtId)
      if (feature) {
        map.stop()
        map.fitBounds(feature.properties.bounds, { padding: 44, duration: reducedMotion() ? 0 : 700, maxZoom: 12.4 })
        pendingFocus.current = null
      }
    }
  }, [districtId, ready])

  useEffect(() => {
    let cancelled = false
    let map: MapInstance | undefined
    let observer: ResizeObserver | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const setup = async () => {
      try {
        const maplibre = await import('maplibre-gl')
        if (cancelled || !container.current) return
        // Районы находятся в сборке и доступны даже при недоступности внешних тайлов.
        const style: StyleSpecification = {
          ...(basemapJson as StyleSpecification),
          sources: { ...(basemapJson as StyleSpecification).sources, [sourceId]: { type: 'geojson', data: districtsGeo } },
          layers: [...(basemapJson as StyleSpecification).layers, ...districtLayers(selectedRef.current)],
        }
        map = new maplibre.Map({
          container: container.current, style, bounds: cityBounds,
          fitBoundsOptions: { padding: 28 },
          maxBounds: [[70.4, 50.5], [72.6, 51.9]], minZoom: 8.5, maxZoom: 16,
          dragRotate: false, pitchWithRotate: false, touchPitch: false,
          attributionControl: false, renderWorldCopies: false,
          cooperativeGestures: true,
          locale: {
            'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl + прокрутка для масштаба',
            'CooperativeGesturesHandler.MacHelpText': '⌘ + прокрутка для масштаба',
            'CooperativeGesturesHandler.MobileHelpText': 'Перемещайте карту двумя пальцами',
          },
        })
        mapRef.current = map
        map.touchZoomRotate.disableRotation()
        const mounted = map
        // Не ждём загрузки всех внешних тайлов, чтобы разрешить выбор районов.
        map.on('style.load', () => {
          if (cancelled) return
          selection(mounted, selectedRef.current)
          clearTimeout(watchdog)
          setReady(true)
        })
        map.on('error', () => { if (!cancelled) setTilesError(true) })
        watchdog = setTimeout(() => { if (!cancelled) { setTilesError(true); setReady(true) } }, 10000)
        for (const feature of districtsGeo.features) {
          const { id, name, label_point, case_district } = feature.properties
          const label = document.createElement('div')
          label.className = 'pointer-events-none'
          label.setAttribute('aria-hidden', 'true')
          const text = document.createElement('div')
          text.className = labelClass(id === selectedRef.current, case_district)
          text.textContent = case_district ? name : `${name} · вне кейса`
          label.append(text)
          const marker = new maplibre.Marker({ element: label, anchor: 'center' }).setLngLat(label_point).addTo(map)
          labels.current.push({ id, enabled: case_district, marker, text })
        }
        map.on('click', (event) => {
          if (!mounted.getLayer('case-fill')) return
          const feature = mounted.queryRenderedFeatures(event.point, { layers: ['case-fill'] })
            .find((f) => f.properties.case_district === true)
          if (feature && typeof feature.properties.id === 'string') onChangeRef.current(feature.properties.id)
        })
        map.on('mousemove', (event) => {
          if (!mounted.getLayer('case-fill')) return
          const feature = mounted.queryRenderedFeatures(event.point, { layers: ['case-fill'] })
            .find((f) => f.properties.case_district === true)
          const id = feature?.properties.id
          mounted.getCanvas().classList.toggle('cursor-pointer!', Boolean(id))
          mounted.setFilter('case-hover', ['==', ['get', 'id'], id && id !== selectedRef.current ? id : ''])
        })
        map.getCanvas().addEventListener('mouseleave', () => {
          if (mounted.getLayer('case-hover')) mounted.setFilter('case-hover', ['==', ['get', 'id'], ''])
        })
        observer = new ResizeObserver(() => mounted.resize())
        observer.observe(container.current)
      } catch {
        if (!cancelled) { setMapError(true); setReady(false) }
      }
    }
    void setup()
    return () => {
      cancelled = true
      clearTimeout(watchdog)
      observer?.disconnect()
      labels.current.forEach((label) => label.marker.remove())
      labels.current = []
      map?.remove()
      mapRef.current = null
    }
  }, [retry])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const controller = new AbortController()
    const layerIds = ['context-areas', 'context-lines', 'context-points']
    for (const id of layerIds) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none')
    if (!layer) return
    async function showLayer() {
      try {
        const data = cache.current.get(layer as MapLayerId) ?? await getMapLayer(layer as MapLayerId, controller.signal)
        if (controller.signal.aborted || !map) return
        cache.current.set(layer as MapLayerId, data)
        if (map.getSource('context')) await (map.getSource('context') as GeoJSONSource).setData(data, true)
        else {
          map.addSource('context', { type: 'geojson', data })
          map.addLayer({ id: 'context-areas', type: 'fill', source: 'context', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#2e8b57', 'fill-opacity': 0.38 } }, 'case-border')
          map.addLayer({ id: 'context-lines', type: 'line', source: 'context', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#b45309', 'line-width': 2, 'line-opacity': 0.65 } }, 'case-border')
          map.addLayer({ id: 'context-points', type: 'circle', source: 'context', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#b45309', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2, 14, 5], 'circle-opacity': 0.8, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } }, 'case-border')
        }
        if (controller.signal.aborted) return
        for (const id of layerIds) map.setLayoutProperty(id, 'visibility', 'visible')
        setLayerStatus('idle')
      } catch {
        if (!controller.signal.aborted) setLayerStatus('error')
      }
    }
    void showLayer()
    return () => controller.abort()
  }, [layer, ready, retry])

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Астана</span>
        <div role="group" aria-label="Выбор района" className="flex flex-wrap gap-1">
          {districts.map((district) => (
            <button key={district.id} type="button" aria-pressed={district.id === districtId}
              onClick={() => onDistrictChange(district.id)}
              className={`min-h-9 rounded-full px-3 py-2 text-xs font-semibold transition-[background-color,color,box-shadow,transform] duration-200 ease-out active:scale-95 motion-reduce:transform-none motion-reduce:transition-none ${district.id === districtId ? 'bg-teal-800 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}>
              {district.name}
            </button>
          ))}
        </div>
      </div>
      <div className="relative isolate h-[440px] overflow-hidden bg-slate-100 sm:h-[520px] xl:h-[min(57vh,660px)] xl:min-h-[440px]">
        <div ref={container} className="h-full w-full" role="region" aria-label={`Карта Астаны. Выбран район ${districts.find((d) => d.id === districtId)?.name ?? ''}`} />
        {!ready && !mapError && <div role="status" className="pointer-events-none absolute inset-x-0 top-5 flex justify-center"><span className="rounded-full bg-white/95 px-4 py-2 text-xs text-slate-600 shadow-sm motion-safe:animate-pulse">Открываем карту…</span></div>}
        {mapError && <div className="absolute inset-0 grid place-content-center gap-3 p-8 text-center">
          <p className="text-sm text-slate-600">Карта недоступна в этом браузере.<br />Выберите район кнопками сверху.</p>
          <button type="button" onClick={() => { setMapError(false); setTilesError(false); setReady(false); setLayer(''); setRetry((n) => n + 1) }} className="rounded-full bg-white px-4 py-2 text-sm text-teal-800 shadow-sm">Повторить</button>
        </div>}
        {ready && !mapError && <>
          <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-2xl bg-white/95 p-1.5 shadow-sm">
            <button type="button" aria-label="Приблизить карту" onClick={() => mapRef.current?.zoomIn({ duration: reducedMotion() ? 0 : 250 })} className="h-9 w-9 rounded-xl text-xl text-slate-600 transition-colors hover:bg-slate-100 motion-reduce:transition-none">+</button>
            <button type="button" aria-label="Отдалить карту" onClick={() => mapRef.current?.zoomOut({ duration: reducedMotion() ? 0 : 250 })} className="h-9 w-9 rounded-xl text-xl text-slate-600 transition-colors hover:bg-slate-100 motion-reduce:transition-none">−</button>
          </div>
          <button type="button" onClick={() => { mapRef.current?.stop(); mapRef.current?.fitBounds(cityBounds, { padding: 28, duration: reducedMotion() ? 0 : 650 }) }} className="absolute bottom-4 left-4 rounded-full bg-white/95 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-white motion-reduce:transition-none">Весь город</button>
          {tilesError && <p role="status" className="absolute bottom-4 right-4 max-w-48 rounded-xl bg-white/95 px-3 py-2 text-xs text-slate-500">Часть подложки недоступна. Районы можно выбирать.</p>}
        </>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
        <label className="flex items-center gap-2 text-xs text-slate-500">Объекты
          <select aria-label="Объекты на карте" value={layer} disabled={!ready || mapError}
            onChange={(event) => { setLayer(event.target.value as MapLayerId | ''); setLayerStatus(event.target.value ? 'loading' : 'idle') }}
            className="min-h-9 max-w-48 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-offset-4 disabled:opacity-40">
            <option value="">Не показывать</option>
            {overlayNames.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <span role="status" className="text-xs text-slate-500">{layerStatus === 'loading' ? 'Загружаем объекты…' : layerStatus === 'error' ? 'Не удалось загрузить. Выберите слой ещё раз.' : ''}</span>
        <span className="text-[10px] text-slate-400">
          © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">OpenStreetMap</a> · <a href="https://openfreemap.org/" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">OpenMapTiles</a>
        </span>
      </div>
    </div>
  )
}
