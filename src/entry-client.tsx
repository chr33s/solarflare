import { hydrate } from 'preact'
import { App } from './app'
import './index.css'

const props = (window as any).__PROPS__ || {}
hydrate(<App {...props} />, document.getElementById('app') as HTMLElement)
