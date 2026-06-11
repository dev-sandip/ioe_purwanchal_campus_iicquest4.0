'use client'

export default function DemoPage() {
  return (
    <main className="min-h-screen bg-[#f5f5f5] p-8">
      <div className="mx-auto max-w-175">
        <h1 className="mb-6 text-center text-3xl font-bold">Pragya Lekh Demo</h1>
        <textarea
          className="w-full min-h-50 rounded-lg border border-gray-300 p-4 text-base focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-y"
          placeholder="नेपाली भाषामा लेख्नुहोस्..."
        />
        <p className="mt-4 text-sm text-gray-500">
          Install the Pragya Lekh extension, then type Nepali text above. The extension will detect spelling errors via the ONNX model. 
        </p>
      </div>
    </main>
  )
}
