// Copyright 2026 Impo. SPDX-License-Identifier: Apache-2.0
export function fixture(surfaceId = 'travel') {
  return [
    { version: 'v0.9', createSurface: { surfaceId, catalogId: 'urn:impo:agenui:web:demo' } },
    { version: 'v0.9', updateDataModel: { surfaceId, path: '/', value: { city: 'Paris', outdoors: true, days: 4 } } },
    { version: 'v0.9', updateComponents: { surfaceId, components: [
      { id: 'root', component: 'Column', children: ['heading', 'description', 'city', 'mirror', 'outdoors', 'days', 'divider', 'submit'], styles: { width: '100%', gap: 20 } },
      { id: 'heading', component: 'Text', text: 'Plan a little escape', variant: 'h2' },
      { id: 'description', component: 'Text', text: 'Edit the form. The shared C++ engine resolves the values and calculates this layout.', styles: { 'line-clamp': 0 } },
      { id: 'city', component: 'TextField', label: 'Destination', value: { path: '/city' }, variant: 'shortText', styles: { height: 152 } },
      { id: 'mirror', component: 'Text', text: { path: '/city' }, styles: { color: '#357561' } },
      { id: 'outdoors', component: 'CheckBox', label: 'Include outdoor activities', value: { path: '/outdoors' }, styles: { height: 88 } },
      { id: 'days', component: 'Slider', label: 'Days away', value: { path: '/days' }, min: 1, max: 14, styles: { height: 180 } },
      { id: 'divider', component: 'Divider', styles: { height: 2 } },
      { id: 'submit', component: 'Button', child: 'submit-label', styles: { height: 96, 'background-color': '#264D3D', 'justify-content': 'center', 'align-items': 'center' }, action: { event: { name: 'plan_trip', context: { city: { path: '/city' }, outdoors: { path: '/outdoors' }, days: { path: '/days' } } } } },
      { id: 'submit-label', component: 'Text', text: 'Plan this trip', styles: { color: '#FFFFFF' } },
    ] } },
  ].map(JSON.stringify).join('\n');
}
