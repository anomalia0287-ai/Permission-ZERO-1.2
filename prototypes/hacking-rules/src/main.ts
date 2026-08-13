import '../styles.css'
import { mountPrototype } from './app'

const root = document.querySelector<HTMLElement>('#prototype')

if (!root) {
  throw new Error('Prototype mount point not found')
}

mountPrototype(root)
