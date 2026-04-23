import { ref, type Ref } from 'vue'

export interface FileDropHandlers {
    isDragging: Ref<boolean>
    onDragEnter: (event: DragEvent) => void
    onDragOver: (event: DragEvent) => void
    onDragLeave: () => void
    onDrop: (event: DragEvent) => void
}

export function useFileDrop(onFiles: (files: File[]) => void): FileDropHandlers {
    const isDragging = ref(false)
    let counter = 0

    function isFileDrag(event: DragEvent): boolean {
        const types = event.dataTransfer?.types
        if (!types) return false
        for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true
        return false
    }

    return {
        isDragging,
        onDragEnter(event) {
            if (!isFileDrag(event)) return
            event.preventDefault()
            counter++
            isDragging.value = true
        },
        onDragOver(event) {
            if (!isFileDrag(event)) return
            event.preventDefault()
        },
        onDragLeave() {
            counter = Math.max(0, counter - 1)
            if (counter === 0) isDragging.value = false
        },
        onDrop(event) {
            event.preventDefault()
            counter = 0
            isDragging.value = false
            const files = event.dataTransfer?.files
            if (!files || files.length === 0) return
            onFiles(Array.from(files))
        }
    }
}
